import { useSyncExternalStore } from 'react'
import { db, type OutboxItem, type OutboxOp } from './db'
import { supabase } from './supabase'
import { open, openJSON, sealJSON } from './crypto'
import { errorMessage, nowISO } from './format'

// Offline-first sync. The phone is the only writer, so there is nothing to merge:
//   write locally  ->  append to the outbox  ->  push FIFO when online  ->  pull changes.
// Every op carries the row's own UUID, so retries are harmless (server upserts).

export interface SyncState {
  running: boolean
  lastSync: string | null
  error: string | null
}

let state: SyncState = { running: false, lastSync: null, error: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Queue a change. A pending op for the same (op, ref) is replaced, so a corrected edit supersedes a failed one. */
export async function enqueue(op: OutboxOp, ref: string, payload: unknown): Promise<void> {
  const sealed = await sealJSON(payload)
  await db.transaction('rw', db.outbox, async () => {
    if (op !== 'remove_files') await db.outbox.where('[op+ref]').equals([op, ref]).delete()
    await db.outbox.add({ op, ref, payload: sealed, attempts: 0, created_at: nowISO() })
  })
  scheduleSync(300)
}

let timer: ReturnType<typeof setTimeout> | undefined
export function scheduleSync(ms = 0): void {
  clearTimeout(timer)
  timer = setTimeout(() => void sync(), ms)
}

export async function sync(): Promise<void> {
  if (state.running) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  set({ running: true, error: null })
  let error: string | null = null
  try {
    error = await pushOutbox()
    await pullAll()
    set({ lastSync: nowISO() })
  } catch (e) {
    error = errorMessage(e)
  } finally {
    set({ running: false, error })
  }
}

/** Push in order; stop at the first failure and back off. Returns the failure message, if any. */
async function pushOutbox(): Promise<string | null> {
  const items = await db.outbox.orderBy('seq').toArray()
  for (const item of items) {
    try {
      await runOp(item)
      await db.outbox.delete(item.seq!)
    } catch (e) {
      const msg = errorMessage(e)
      await db.outbox.update(item.seq!, { attempts: item.attempts + 1, last_error: msg })
      scheduleSync(Math.min(60_000, 1000 * 2 ** item.attempts))
      return msg
    }
  }
  return null
}

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}

async function runOp(item: OutboxItem): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = await openJSON<any>(item.payload)
  switch (item.op) {
    case 'upsert_person':
      return fail((await supabase.rpc('upsert_person', { p })).error)
    case 'upsert_id_proof':
      return fail((await supabase.rpc('upsert_id_proof', { p })).error)
    case 'upsert_loan':
      return fail((await supabase.from('loans').upsert(p)).error)
    case 'upsert_installments':
      return fail((await supabase.from('installments').upsert(p)).error)
    case 'delete_installments':
      return fail(
        (await supabase.from('installments').delete().eq('loan_id', p.loan_id).gt('no', p.keep))
          .error,
      )
    case 'upsert_phone_verification':
      return fail((await supabase.from('phone_verifications').upsert(p)).error)
    case 'remove_files':
      return fail((await supabase.storage.from('docs').remove(p.paths)).error)
    case 'upsert_document': {
      const blob = await db.blobs.get(p.id)
      if (blob?.full && !blob.uploaded) {
        const bytes = await open(blob.full)
        fail(
          (
            await supabase.storage
              .from('docs')
              .upload(p.storage_path, new Blob([bytes], { type: 'image/jpeg' }), {
                upsert: true,
                contentType: 'image/jpeg',
              })
          ).error,
        )
      }
      fail((await supabase.from('documents').upsert(p)).error)
      if (blob) await db.blobs.update(p.id, { uploaded: true, full: undefined })
      return
    }
  }
}

const TABLES = [
  'people',
  'id_proofs',
  'loans',
  'installments',
  'documents',
  'phone_verifications',
] as const
const PAGE = 1000
const ts = (iso: string) => new Date(iso).getTime()

/** Pull rows changed on the server since the last pull. A local edit that is newer than the server copy is kept. */
async function pullAll(): Promise<void> {
  for (const name of TABLES) {
    const table = db.table(name)
    const key = name === 'phone_verifications' ? 'phone' : 'id'
    for (;;) {
      const since =
        ((await db.meta.get(`pull_${name}`))?.value as string | undefined) ?? '1970-01-01'
      const { data, error } = await supabase
        .from(name)
        .select('*')
        .gte('synced_at', since)
        .order('synced_at')
        .limit(PAGE)
      fail(error)
      const rows = data ?? []
      if (rows.length === 0) break
      await db.transaction('rw', table, db.meta, async () => {
        for (const row of rows) {
          const local = await table.get(row[key])
          if (local && ts(local.updated_at) > ts(row.updated_at)) continue
          await table.put(row)
        }
        await db.meta.put({ key: `pull_${name}`, value: rows[rows.length - 1]!.synced_at })
      })
      if (rows.length < PAGE) break
    }
  }
}

/** Drop the change at the head of the queue (admin's escape hatch for a rejected write). */
export async function discardFailedChange(): Promise<void> {
  const head = await db.outbox.orderBy('seq').first()
  if (head) await db.outbox.delete(head.seq!)
  set({ error: null })
}

export function startSyncTriggers(): () => void {
  const onOnline = () => scheduleSync()
  const onVisible = () => document.visibilityState === 'visible' && scheduleSync()
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  const interval = setInterval(() => scheduleSync(), 60_000)
  scheduleSync()
  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(interval)
  }
}
