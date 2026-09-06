import { beforeEach, describe, expect, it, vi } from 'vitest'

// Plaintext stand-in for the AES helpers: the sync logic is what is under test.
vi.mock('./crypto', () => ({
  sealJSON: async (v: unknown) => ({
    iv: new Uint8Array(0),
    data: new TextEncoder().encode(JSON.stringify(v)).buffer,
  }),
  openJSON: async (s: { data: ArrayBuffer }) => JSON.parse(new TextDecoder().decode(s.data)),
  open: async (s: { data: ArrayBuffer }) => s.data,
}))

const calls: string[] = []
let failOnce = new Set<string>()
const serverRows: Record<string, unknown[]> = {}

function result(name: string) {
  if (failOnce.has(name)) {
    failOnce.delete(name)
    return { error: { message: `boom ${name}` }, data: null }
  }
  return { error: null, data: null }
}

vi.mock('./supabase', () => {
  const from = (table: string) => ({
    upsert: async (rows: unknown) => {
      calls.push(`upsert:${table}:${Array.isArray(rows) ? rows.length : 1}`)
      return result(`upsert:${table}`)
    },
    delete: () => ({
      eq: () => ({ gt: async () => (calls.push(`delete:${table}`), result(`delete:${table}`)) }),
    }),
    select: () => ({
      gte: () => ({
        order: () => ({
          limit: async () => ({ error: null, data: serverRows[table] ?? [] }),
        }),
      }),
    }),
  })
  return {
    supabase: {
      rpc: async (fn: string) => (calls.push(`rpc:${fn}`), result(`rpc:${fn}`)),
      from,
      storage: {
        from: () => ({
          upload: async (p: string) => (calls.push(`upload:${p}`), result('upload')),
          remove: async () => result('remove'),
        }),
      },
    },
  }
})

import { db } from './db'
import { enqueue, sync } from './sync'

beforeEach(async () => {
  calls.length = 0
  failOnce = new Set()
  for (const k of Object.keys(serverRows)) delete serverRows[k]
  await db.delete()
  await db.open()
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
})

describe('outbox', () => {
  it('pushes in FIFO order and drains', async () => {
    await enqueue('upsert_person', 'p1', { id: 'p1' })
    await enqueue('upsert_id_proof', 'x1', { id: 'x1', person_id: 'p1', id_number: '499118665246' })
    await enqueue('upsert_loan', 'l1', { id: 'l1' })
    await enqueue('upsert_installments', 'l1', [{ id: 'i1' }, { id: 'i2' }])
    await sync()
    expect(calls).toEqual([
      'rpc:upsert_person',
      'rpc:upsert_id_proof',
      'upsert:loans:1',
      'upsert:installments:2',
    ])
    expect(await db.outbox.count()).toBe(0)
  })

  it('stops at the first failure, keeps order, and succeeds on retry', async () => {
    failOnce.add('upsert:loans')
    await enqueue('upsert_person', 'p1', { id: 'p1' })
    await enqueue('upsert_loan', 'l1', { id: 'l1' })
    await enqueue('upsert_installments', 'l1', [{ id: 'i1' }])
    await sync()
    expect(calls).toEqual(['rpc:upsert_person', 'upsert:loans:1'])
    expect(await db.outbox.count()).toBe(2)
    const head = await db.outbox.orderBy('seq').first()
    expect(head?.attempts).toBe(1)
    expect(head?.last_error).toMatch(/boom/)
    calls.length = 0
    await sync()
    expect(calls).toEqual(['upsert:loans:1', 'upsert:installments:1'])
    expect(await db.outbox.count()).toBe(0)
  })

  it('replaces a pending op for the same record', async () => {
    await enqueue('upsert_loan', 'l1', { id: 'l1', loan_no: '7' })
    await enqueue('upsert_loan', 'l1', { id: 'l1', loan_no: '8' })
    await enqueue('upsert_loan', 'l2', { id: 'l2' })
    expect(await db.outbox.count()).toBe(2)
    await sync()
    expect(calls).toEqual(['upsert:loans:1', 'upsert:loans:1'])
  })

  it('uploads a photo before writing its document row, then drops the full-size bytes', async () => {
    await db.blobs.put({
      id: 'd1',
      full: { iv: new Uint8Array(0), data: new Uint8Array([1, 2, 3]).buffer },
      thumb: { iv: new Uint8Array(0), data: new ArrayBuffer(0) },
      uploaded: false,
    })
    await enqueue('upsert_document', 'd1', { id: 'd1', storage_path: 'people/p1/id_front.jpg' })
    await sync()
    expect(calls).toEqual(['upload:people/p1/id_front.jpg', 'upsert:documents:1'])
    const blob = await db.blobs.get('d1')
    expect(blob?.uploaded).toBe(true)
    expect(blob?.full).toBeUndefined()
  })
})

describe('pull', () => {
  it('writes server rows into the mirror and keeps newer local edits', async () => {
    await db.people.put({
      id: 'p1',
      full_name: 'Local newer',
      phone: '+919876543210',
      address: null,
      occupation: null,
      notes: null,
      updated_at: '2026-09-05T10:00:00.000Z',
      deleted_at: null,
    })
    serverRows.people = [
      {
        id: 'p1',
        full_name: 'Server older',
        phone: '+919876543210',
        updated_at: '2026-09-05T09:00:00+00:00',
        synced_at: '2026-09-05T09:00:01+00:00',
      },
      {
        id: 'p2',
        full_name: 'Server new',
        phone: '+919876543211',
        updated_at: '2026-09-05T09:30:00+00:00',
        synced_at: '2026-09-05T09:30:01+00:00',
      },
    ]
    await sync()
    expect((await db.people.get('p1'))?.full_name).toBe('Local newer')
    expect((await db.people.get('p2'))?.full_name).toBe('Server new')
    expect((await db.meta.get('pull_people'))?.value).toBe('2026-09-05T09:30:01+00:00')
  })

  it('does nothing while offline', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true })
    await enqueue('upsert_person', 'p1', { id: 'p1' })
    await sync()
    expect(calls).toEqual([])
    expect(await db.outbox.count()).toBe(1)
  })
})
