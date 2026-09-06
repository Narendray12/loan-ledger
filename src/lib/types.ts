// Row shapes shared by the Postgres tables and the Dexie mirror.
export type IdType = 'aadhaar' | 'pan' | 'voter_id' | 'driving_licence'
export type DocType = 'person_photo' | 'id_front' | 'id_back' | 'signed_form' | 'other'
export type PaidMode = 'cash' | 'upi' | 'bank' | 'other'
export type LoanStatus = 'active' | 'closed'

export const ID_TYPES: IdType[] = ['aadhaar', 'pan', 'voter_id', 'driving_licence']
export const ID_LABELS: Record<IdType, string> = {
  aadhaar: 'Aadhaar',
  pan: 'PAN',
  voter_id: 'Voter ID',
  driving_licence: 'Driving licence',
}
export const ID_SHORT: Record<IdType, string> = { ...ID_LABELS, driving_licence: 'DL' }
/** PAN cards have no back side. */
export const hasBackSide = (t: IdType) => t !== 'pan'

export interface Person {
  id: string
  full_name: string
  phone: string // E.164, +91XXXXXXXXXX
  address: string | null
  occupation: string | null
  notes: string | null
  updated_at: string
  synced_at?: string
  deleted_at: string | null
}

/** One ID document a person handed over. The number lives encrypted on the server only. */
export interface IdProof {
  id: string
  person_id: string
  id_type: IdType
  id_last4: string | null
  updated_at: string
  synced_at?: string
  deleted_at: string | null
}

export interface Loan {
  id: string
  loan_no: string
  borrower_id: string
  co_borrower_id: string | null
  amount: number
  loan_date: string
  tenure_months: number
  installment_amount: number
  total_repayment: number
  first_due_date: string
  business_name: string | null
  business_address: string | null
  business_mobile: string | null
  monthly_income: number | null
  ref1_name: string
  ref1_phone: string
  ref1_address: string | null
  ref2_name: string
  ref2_phone: string
  ref2_address: string | null
  status: LoanStatus
  settled_on: string | null
  notes: string | null
  updated_at: string
  synced_at?: string
  deleted_at: string | null
}

export interface Installment {
  id: string
  loan_id: string
  no: number
  due_date: string
  amount_due: number
  paid_amount: number
  paid_on: string | null
  paid_mode: PaidMode | null
  note: string | null
  marked_by: string | null
  updated_at: string
  synced_at?: string
}

export interface Doc {
  id: string
  person_id: string | null
  loan_id: string | null
  id_proof_id: string | null
  type: DocType
  storage_path: string
  sha256: string | null
  captured_at: string
  caption: string | null
  updated_at: string
  synced_at?: string
  deleted_at: string | null
  /** Local only: photos taken inside an unsaved application draft. Stripped before push. */
  draft_id?: string
}

export interface PhoneVerification {
  phone: string
  verified_at: string
  person_id: string | null
  proof: string | null
  updated_at: string
  synced_at?: string
}
