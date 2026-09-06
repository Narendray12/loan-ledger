import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import {
  deletePhoto,
  ensureThumb,
  localImageUrl,
  savePhoto,
  signedUrl,
  type Owner,
} from '../lib/docs'
import { errorMessage } from '../lib/format'
import type { Doc, DocType } from '../lib/types'
import { IconCamera, IconIdCard, IconUser } from './icons'
import { Button, cx, Sheet } from './ui'

export function useThumb(doc: Doc | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  const blobRow = useLiveQuery(() => (doc ? db.blobs.get(doc.id) : undefined), [doc?.id])
  useEffect(() => {
    let current: string | null = null
    let cancelled = false
    if (doc) {
      void (async () => {
        let u = await localImageUrl(doc.id, 'thumb')
        if (!u) {
          await ensureThumb(doc).catch(() => undefined)
          u = await localImageUrl(doc.id, 'thumb')
        }
        if (cancelled) {
          if (u) URL.revokeObjectURL(u)
          return
        }
        current = u
        setUrl(u)
      })()
    } else {
      setUrl(null)
    }
    return () => {
      cancelled = true
      if (current) URL.revokeObjectURL(current)
    }
  }, [doc, blobRow?.uploaded])
  return url
}

const facingFor = (type: DocType) => (type === 'person_photo' ? 'user' : 'environment')

function FileInput({
  facing,
  disabled,
  onFile,
}: {
  facing: 'user' | 'environment'
  disabled?: boolean
  onFile: (f: File) => void
}) {
  return (
    <input
      type="file"
      accept="image/*"
      capture={facing}
      className="hidden"
      disabled={disabled}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) onFile(f)
      }}
    />
  )
}

/** Full-size view with retake and delete. */
function FullView({
  doc,
  label,
  onClose,
  onRetake,
  onDelete,
}: {
  doc: Doc | null
  label: string
  onClose: () => void
  onRetake?: (f: File) => void
  onDelete?: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!doc) return
    let local: string | null = null
    void (async () => {
      try {
        local = await localImageUrl(doc.id, 'full')
        setUrl(local ?? (await signedUrl(doc.storage_path)))
      } catch (e) {
        setError(errorMessage(e))
      }
    })()
    return () => {
      if (local) URL.revokeObjectURL(local)
      setUrl(null)
      setError(null)
    }
  }, [doc])
  return (
    <Sheet open={doc !== null} onClose={onClose} title={label}>
      {error ? (
        <p className="text-sm text-late">{error} (full size needs internet)</p>
      ) : url ? (
        <img src={url} alt={label} className="max-h-[60dvh] w-full rounded-2xl object-contain" />
      ) : (
        <p className="text-sm text-ink-3">Loading…</p>
      )}
      {(onRetake || onDelete) && (
        <div className="mt-4 flex gap-2.5">
          {onDelete && (
            <Button variant="danger" className="w-28" onClick={onDelete}>
              Delete
            </Button>
          )}
          {onRetake && doc && (
            <label className="inline-flex h-13 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-rule-2 bg-white text-base font-semibold text-ink">
              <IconCamera size={20} /> Retake
              <FileInput facing={facingFor(doc.type)} onFile={onRetake} />
            </label>
          )}
        </div>
      )}
    </Sheet>
  )
}

/** Square photo slot: captured image with a label, or a dashed camera tile. */
function Tile({
  doc,
  url,
  label,
  size,
  placeholder,
  busy,
  onOpen,
  onFile,
  facing,
}: {
  doc: Doc | undefined
  url: string | null
  label: string
  size: number
  placeholder: ReactNode
  busy: boolean
  onOpen: () => void
  onFile: (f: File) => void
  facing: 'user' | 'environment'
}) {
  const box = { width: size, height: size }
  if (doc) {
    return (
      <button
        type="button"
        onClick={onOpen}
        style={box}
        className="relative shrink-0 overflow-hidden rounded-[14px] border-[1.5px] border-paid-line bg-tint"
      >
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-ink-2">
            {placeholder}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 truncate bg-ink/55 px-2 py-1 text-left text-[10px] font-semibold text-paper">
          {label}
        </span>
      </button>
    )
  }
  return (
    <label
      style={box}
      className={cx(
        'flex shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-rule-2 bg-white px-1 text-center text-xs font-medium text-ink-3',
        busy && 'opacity-60',
      )}
    >
      <IconCamera size={22} />
      <span className="line-clamp-2">{busy ? 'Saving…' : label}</span>
      <FileInput facing={facing} disabled={busy} onFile={onFile} />
    </label>
  )
}

/** One fixed photo slot (person photo, ID front, ID back). Retake replaces the photo. */
export function PhotoTile({
  owner,
  type,
  label,
  draftId,
  size = 106,
}: {
  owner: Owner
  type: DocType
  label: string
  draftId?: string
  size?: number
}) {
  const doc = useLiveQuery(
    () =>
      (owner.id_proof_id
        ? db.documents.where('[id_proof_id+type]').equals([owner.id_proof_id, type])
        : db.documents.where('[person_id+type]').equals([owner.person_id ?? '', type])
      )
        .filter((d) => !d.deleted_at)
        .first(),
    [owner.person_id, owner.id_proof_id, type],
  )
  const url = useThumb(doc)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)

  const onFile = async (file: File) => {
    setBusy(true)
    setError(null)
    setViewing(false)
    try {
      await savePhoto(file, owner, type, { draftId, existingId: doc?.id })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Tile
        doc={doc}
        url={url}
        label={label}
        size={size}
        placeholder={type === 'person_photo' ? <IconUser size={30} /> : <IconIdCard size={30} />}
        busy={busy}
        onOpen={() => setViewing(true)}
        onFile={(f) => void onFile(f)}
        facing={facingFor(type)}
      />
      {error && <p className="mt-1 text-xs text-late">{error}</p>}
      <FullView
        doc={viewing && doc ? doc : null}
        label={label}
        onClose={() => setViewing(false)}
        onRetake={(f) => void onFile(f)}
        onDelete={() => {
          if (doc && confirm('Delete this photo?')) {
            setViewing(false)
            void deletePhoto(doc)
          }
        }}
      />
    </div>
  )
}

function MultiItem({ doc, label, size }: { doc: Doc; label: string; size: number }) {
  const url = useThumb(doc)
  const [viewing, setViewing] = useState(false)
  return (
    <>
      <Tile
        doc={doc}
        url={url}
        label={label}
        size={size}
        placeholder={<IconIdCard size={30} />}
        busy={false}
        onOpen={() => setViewing(true)}
        onFile={() => undefined}
        facing="environment"
      />
      <FullView
        doc={viewing ? doc : null}
        label={label}
        onClose={() => setViewing(false)}
        onDelete={() => {
          if (confirm('Delete this photo?')) {
            setViewing(false)
            void deletePhoto(doc)
          }
        }}
      />
    </>
  )
}

/** Any number of photos (signed form pages, other documents). */
export function PhotoMulti({
  owner,
  type,
  label,
  addLabel,
  draftId,
  size = 106,
}: {
  owner: Owner
  type: DocType
  label: string
  addLabel?: string
  draftId?: string
  size?: number
}) {
  const docs = useLiveQuery(
    () =>
      (owner.person_id
        ? db.documents.where('person_id').equals(owner.person_id)
        : db.documents.where('loan_id').equals(owner.loan_id!)
      )
        .filter((d) => d.type === type && !d.deleted_at)
        .sortBy('captured_at'),
    [owner.person_id, owner.loan_id, type],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      await savePhoto(file, owner, type, { draftId })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2.5">
        {docs?.map((d, i) => (
          <MultiItem
            key={d.id}
            doc={d}
            label={docs.length > 1 ? `${label} ${i + 1}` : label}
            size={size}
          />
        ))}
        <Tile
          doc={undefined}
          url={null}
          label={addLabel ?? (docs?.length ? 'Add page' : label)}
          size={size}
          placeholder={null}
          busy={busy}
          onOpen={() => undefined}
          onFile={(f) => void onFile(f)}
          facing="environment"
        />
      </div>
      {error && <p className="mt-1 text-xs text-late">{error}</p>}
    </div>
  )
}
