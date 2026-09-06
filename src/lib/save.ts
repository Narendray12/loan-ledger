import { db } from './db'
import { enqueue } from './sync'
import { generateCards } from './cards'
import { commitDraftPhotos, deleteProofPhotos } from './docs'
import { blank, nowISO } from './format'
import { normalizeId, toE164 } from './validators'
import type { ApplicationValues, IdProofForm, LoanForm, PersonValues } from './schemas'
import type { IdProof, Installment, Loan, Person } from './types'

export function personFromForm(f: PersonValues, now: string, existing?: Person): Person {
  return {
    ...existing,
    id: f.id,
    full_name: f.full_name.trim(),
    phone: toE164(f.phone),
    address: blank(f.address),
    occupation: blank(f.occupation),
    notes: blank(f.notes),
    updated_at: now,
    deleted_at: existing?.deleted_at ?? null,
  }
}

/** Form entry -> mirror row (+ the plaintext number, which only ever travels inside the sealed outbox). */
function proofFromForm(
  personId: string,
  f: IdProofForm,
  now: string,
  existing?: IdProof,
): { row: IdProof; id_number?: string } {
  const id_number = f.id_number ? normalizeId(f.id_type, f.id_number) : undefined
  return {
    row: {
      id: f.id,
      person_id: personId,
      id_type: f.id_type,
      id_last4: id_number ? id_number.slice(-4) : (existing?.id_last4 ?? blank(f.id_last4)),
      updated_at: now,
      deleted_at: null,
    },
    id_number,
  }
}

/**
 * Mirror and queue one person with their ID proofs. Proofs no longer in the form are
 * soft-deleted along with their photos, which also drops the encrypted number on the server.
 */
async function persistPerson(f: PersonValues, now: string): Promise<Person> {
  const existing = await db.people.get(f.id)
  const row = personFromForm(f, now, existing)
  const current = await db.id_proofs
    .where('person_id')
    .equals(f.id)
    .filter((p) => !p.deleted_at)
    .toArray()
  const byId = new Map(current.map((p) => [p.id, p]))
  const proofs = f.id_proofs.map((p) => proofFromForm(f.id, p, now, byId.get(p.id)))
  const keep = new Set(proofs.map((p) => p.row.id))
  const dropped = current
    .filter((p) => !keep.has(p.id))
    .map((p) => ({ ...p, deleted_at: now, updated_at: now }))

  await db.transaction('rw', db.people, db.id_proofs, async () => {
    await db.people.put(row)
    await db.id_proofs.bulkPut([...proofs.map((p) => p.row), ...dropped])
  })
  await enqueue('upsert_person', row.id, row)
  for (const p of proofs) {
    await enqueue('upsert_id_proof', p.row.id, {
      ...p.row,
      ...(p.id_number !== undefined ? { id_number: p.id_number } : {}),
    })
  }
  for (const d of dropped) {
    await enqueue('upsert_id_proof', d.id, d)
    await deleteProofPhotos(d.id)
  }
  return row
}

export const savePerson = (f: PersonValues): Promise<Person> => persistPerson(f, nowISO())

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function loanFromForm(
  f: LoanForm & {
    amount: number
    tenure_months: number
    installment_amount: number
    total_repayment: number
  },
  ids: { borrower_id: string; co_borrower_id: string | null },
  now: string,
  existing?: Loan,
): Loan {
  return {
    status: 'active',
    settled_on: null,
    deleted_at: null,
    ...existing,
    id: f.id,
    loan_no: f.loan_no.trim(),
    borrower_id: ids.borrower_id,
    co_borrower_id: ids.co_borrower_id,
    amount: f.amount,
    loan_date: f.loan_date,
    tenure_months: f.tenure_months,
    installment_amount: f.installment_amount,
    total_repayment: f.total_repayment,
    first_due_date: f.first_due_date,
    business_name: blank(f.business_name),
    business_address: blank(f.business_address),
    business_mobile: f.business_mobile ? toE164(f.business_mobile) : null,
    monthly_income: num(f.monthly_income),
    ref1_name: f.ref1_name.trim(),
    ref1_phone: toE164(f.ref1_phone),
    ref1_address: blank(f.ref1_address),
    ref2_name: f.ref2_name.trim(),
    ref2_phone: toE164(f.ref2_phone),
    ref2_address: blank(f.ref2_address),
    notes: blank(f.notes),
    updated_at: now,
  }
}

const serverLoan = ({ synced_at: _s, ...loan }: Loan) => loan

/** Whole paper form -> people, ID proofs, loan and its monthly cards, all queued in FK order. */
export async function saveApplication(values: ApplicationValues, draftId: string): Promise<string> {
  const now = nowISO()
  const borrower = await persistPerson(values.borrower, now)
  const co =
    values.has_co_borrower && values.co_borrower
      ? await persistPerson(values.co_borrower, now)
      : null
  const loan = loanFromForm(
    values.loan,
    { borrower_id: borrower.id, co_borrower_id: co?.id ?? null },
    now,
  )
  const cards = generateCards(loan, now)
  await db.transaction('rw', db.loans, db.installments, async () => {
    await db.loans.put(loan)
    await db.installments.bulkPut(cards)
  })
  await enqueue('upsert_loan', loan.id, serverLoan(loan))
  await enqueue('upsert_installments', loan.id, cards)
  await commitDraftPhotos(draftId)
  await db.drafts.delete(draftId)
  return loan.id
}

export async function saveLoan(loan: Loan, regenerate: boolean): Promise<void> {
  const now = nowISO()
  const row = { ...loan, updated_at: now }
  await db.loans.put(row)
  await enqueue('upsert_loan', row.id, serverLoan(row))
  if (!regenerate) return
  const old = await db.installments.where('loan_id').equals(row.id).sortBy('no')
  const cards: Installment[] = generateCards(
    row,
    now,
    old.map((c) => c.id),
  )
  await db.transaction('rw', db.installments, async () => {
    await db.installments
      .where('loan_id')
      .equals(row.id)
      .filter((c) => c.no > row.tenure_months)
      .delete()
    await db.installments.bulkPut(cards)
  })
  await enqueue('upsert_installments', row.id, cards)
  if (old.length > row.tenure_months) {
    await enqueue('delete_installments', row.id, { loan_id: row.id, keep: row.tenure_months })
  }
}

export async function saveInstallment(
  card: Installment,
  patch: Partial<Installment>,
): Promise<void> {
  const row = { ...card, ...patch, updated_at: nowISO() }
  await db.installments.put(row)
  await enqueue('upsert_installments', row.id, [row])
}

/** Soft-delete plus removal of the object's files from storage. */
export async function softDeleteWithFiles(kind: 'person' | 'loan', id: string): Promise<void> {
  const now = nowISO()
  const docs = await (
    kind === 'person'
      ? db.documents.where('person_id').equals(id)
      : db.documents.where('loan_id').equals(id)
  )
    .filter((d) => !d.deleted_at)
    .toArray()
  if (kind === 'person') {
    const row = { ...(await db.people.get(id))!, deleted_at: now, updated_at: now }
    await db.people.put(row)
    await enqueue('upsert_person', id, row)
    const proofs = (await db.id_proofs.where('person_id').equals(id).toArray())
      .filter((p) => !p.deleted_at)
      .map((p) => ({ ...p, deleted_at: now, updated_at: now }))
    await db.id_proofs.bulkPut(proofs)
    for (const p of proofs) await enqueue('upsert_id_proof', p.id, p)
  } else {
    const row = { ...(await db.loans.get(id))!, deleted_at: now, updated_at: now }
    await db.loans.put(row)
    await enqueue('upsert_loan', id, serverLoan(row))
  }
  if (docs.length) {
    await db.transaction('rw', db.documents, db.blobs, async () => {
      await db.documents.bulkPut(docs.map((d) => ({ ...d, deleted_at: now, updated_at: now })))
      await db.blobs.bulkDelete(docs.map((d) => d.id))
    })
    await enqueue('remove_files', id, { paths: docs.map((d) => d.storage_path) })
    for (const d of docs) {
      const { draft_id: _x, synced_at: _y, ...row } = { ...d, deleted_at: now, updated_at: now }
      await enqueue('upsert_document', d.id, row)
    }
  }
}
