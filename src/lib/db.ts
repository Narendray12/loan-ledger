import Dexie, { type EntityTable } from 'dexie'
import type { Doc, IdProof, Installment, Loan, Person, PhoneVerification } from './types'

/** AES-GCM ciphertext produced by crypto.ts. */
export interface Sealed {
  iv: Uint8Array<ArrayBuffer>
  data: ArrayBuffer
}

/** Photo bytes for a document. `full` is dropped once uploaded; `thumb` stays for offline viewing. */
export interface BlobRow {
  id: string // documents.id
  full?: Sealed
  thumb: Sealed
  uploaded: boolean
}

export interface Draft {
  id: string
  title: string
  data: Sealed
  updated_at: string
}

export type OutboxOp =
  | 'upsert_person'
  | 'upsert_id_proof'
  | 'upsert_loan'
  | 'upsert_installments'
  | 'delete_installments'
  | 'upsert_document'
  | 'upsert_phone_verification'
  | 'remove_files'

export interface OutboxItem {
  seq?: number
  op: OutboxOp
  /** Record the op is about; a newer op with the same (op, ref) replaces an older pending one. */
  ref: string
  payload: Sealed
  attempts: number
  last_error?: string
  created_at: string
}

export interface Meta {
  key: string
  value: unknown
}

class LedgerDB extends Dexie {
  people!: EntityTable<Person, 'id'>
  id_proofs!: EntityTable<IdProof, 'id'>
  loans!: EntityTable<Loan, 'id'>
  installments!: EntityTable<Installment, 'id'>
  documents!: EntityTable<Doc, 'id'>
  phone_verifications!: EntityTable<PhoneVerification, 'phone'>
  blobs!: EntityTable<BlobRow, 'id'>
  drafts!: EntityTable<Draft, 'id'>
  outbox!: EntityTable<OutboxItem, 'seq'>
  meta!: EntityTable<Meta, 'key'>

  constructor() {
    super('loan-ledger')
    this.version(1).stores({
      people: 'id, phone, deleted_at',
      loans: 'id, loan_no, borrower_id, co_borrower_id, deleted_at',
      installments: 'id, loan_id, due_date, [loan_id+no]',
      documents: 'id, person_id, loan_id, draft_id, [person_id+type]',
      phone_verifications: 'phone',
      blobs: 'id',
      drafts: 'id, updated_at',
      outbox: '++seq, [op+ref]',
      meta: 'key',
    })
    // v2: ID proofs are their own table (several per person); ID photos hang off the proof.
    // People and documents are re-pulled from the server, which is the source of truth.
    this.version(2)
      .stores({
        people: 'id, phone, deleted_at',
        id_proofs: 'id, person_id, deleted_at',
        loans: 'id, loan_no, borrower_id, co_borrower_id, deleted_at',
        installments: 'id, loan_id, due_date, [loan_id+no]',
        documents:
          'id, person_id, loan_id, id_proof_id, draft_id, [person_id+type], [id_proof_id+type]',
        phone_verifications: 'phone',
        blobs: 'id',
        drafts: 'id, updated_at',
        outbox: '++seq, [op+ref]',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx.table('people').clear()
        await tx.table('documents').clear()
        await tx.table('meta').bulkDelete(['pull_people', 'pull_documents'])
      })
  }
}

export const db = new LedgerDB()

/** Forget everything on this device (logout). */
export async function wipeLocal() {
  await db.delete()
  await db.open()
}
