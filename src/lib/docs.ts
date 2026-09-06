import { db } from './db'
import { seal, open } from './crypto'
import { processImage } from './image'
import { enqueue } from './sync'
import { supabase } from './supabase'
import { nowISO, uuid } from './format'
import type { Doc, DocType } from './types'

/** Who a photo belongs to. ID sides also name the proof they show. */
export type Owner =
  | { person_id: string; id_proof_id?: string; loan_id?: undefined }
  | { loan_id: string; person_id?: undefined; id_proof_id?: undefined }

export const SIDE_TYPES: DocType[] = ['id_front', 'id_back']

/** Fixed slots overwrite the same object on retake, so there are never orphaned files. */
export function storagePath(owner: Owner, type: DocType, docId: string): string {
  if (owner.person_id) {
    if (type === 'person_photo') return `people/${owner.person_id}/person_photo.jpg`
    if (owner.id_proof_id && SIDE_TYPES.includes(type)) {
      return `people/${owner.person_id}/ids/${owner.id_proof_id}-${type}.jpg`
    }
    return `people/${owner.person_id}/${type}-${docId}.jpg`
  }
  return `loans/${owner.loan_id}/${type}-${docId}.jpg`
}

/** Strip local-only fields before the row goes to the server. */
export const serverDoc = ({ draft_id: _d, synced_at: _s, ...row }: Doc) => row

/**
 * Store a captured photo locally. Fixed slots reuse the existing row so a retake replaces the
 * old photo. Pass `draftId` while inside an unsaved application (queued at save time);
 * otherwise the upload is queued immediately.
 */
export async function savePhoto(
  file: Blob,
  owner: Owner,
  type: DocType,
  opts: { draftId?: string; existingId?: string } = {},
): Promise<Doc> {
  const { full, thumb, sha256 } = await processImage(file)
  const id = opts.existingId ?? uuid()
  // A retake of a photo that already exists outside the draft applies immediately;
  // only brand-new photos are held back until the application is saved.
  const existing = opts.existingId ? await db.documents.get(opts.existingId) : undefined
  const inDraft = Boolean(opts.draftId) && (!existing || Boolean(existing.draft_id))
  const now = nowISO()
  const row: Doc = {
    id,
    person_id: owner.person_id ?? null,
    loan_id: owner.loan_id ?? null,
    id_proof_id: owner.id_proof_id ?? null,
    type,
    storage_path: storagePath(owner, type, id),
    sha256,
    captured_at: now,
    caption: null,
    updated_at: now,
    deleted_at: null,
    ...(inDraft ? { draft_id: opts.draftId } : {}),
  }
  const [sf, st] = await Promise.all([
    seal(await full.arrayBuffer()),
    seal(await thumb.arrayBuffer()),
  ])
  await db.transaction('rw', db.documents, db.blobs, async () => {
    await db.blobs.put({ id, full: sf, thumb: st, uploaded: false })
    await db.documents.put(row)
  })
  if (!inDraft) await enqueue('upsert_document', id, serverDoc(row))
  return row
}

export async function deletePhoto(doc: Doc): Promise<void> {
  const now = nowISO()
  const row = { ...doc, deleted_at: now, updated_at: now }
  await db.transaction('rw', db.documents, db.blobs, async () => {
    await db.documents.put(row)
    await db.blobs.delete(doc.id)
  })
  if (!doc.draft_id) {
    await enqueue('remove_files', doc.id, { paths: [doc.storage_path] })
    await enqueue('upsert_document', doc.id, serverDoc(row))
  }
}

/** Both sides of an ID proof go with it. */
export async function deleteProofPhotos(idProofId: string): Promise<void> {
  const docs = await db.documents
    .where('id_proof_id')
    .equals(idProofId)
    .filter((d) => !d.deleted_at)
    .toArray()
  for (const d of docs) await deletePhoto(d)
}

/** Photos taken inside a draft become real documents when the application is saved. */
export async function commitDraftPhotos(draftId: string): Promise<void> {
  const docs = await db.documents.where('draft_id').equals(draftId).toArray()
  for (const doc of docs) {
    const { draft_id: _d, ...row } = doc
    await db.documents.put(row)
    await enqueue('upsert_document', row.id, serverDoc(row))
  }
}

export async function discardDraftPhotos(draftId: string): Promise<void> {
  const docs = await db.documents.where('draft_id').equals(draftId).toArray()
  await db.transaction('rw', db.documents, db.blobs, async () => {
    await db.documents.bulkDelete(docs.map((d) => d.id))
    await db.blobs.bulkDelete(docs.map((d) => d.id))
  })
}

/** Decrypt the local thumbnail or full image into an object URL. Caller revokes it. */
export async function localImageUrl(docId: string, size: 'thumb' | 'full'): Promise<string | null> {
  const blob = await db.blobs.get(docId)
  const sealed = size === 'full' ? blob?.full : blob?.thumb
  if (!sealed) return null
  return URL.createObjectURL(new Blob([await open(sealed)], { type: 'image/jpeg' }))
}

export async function signedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('docs').createSignedUrl(path, 300)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

/** A photo taken on another device has no local bytes: fetch once and keep a thumbnail. */
export async function ensureThumb(doc: Doc): Promise<void> {
  if (await db.blobs.get(doc.id)) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  const res = await fetch(await signedUrl(doc.storage_path))
  if (!res.ok) throw new Error(`Photo download failed (${res.status})`)
  const { thumb } = await processImage(await res.blob())
  await db.blobs.put({ id: doc.id, thumb: await seal(await thumb.arrayBuffer()), uploaded: true })
}
