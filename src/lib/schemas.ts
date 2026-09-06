import { z } from 'zod'
import { idError, PHONE10 } from './validators'
import { ID_TYPES } from './types'

const phone10 = z.string().trim().regex(PHONE10, 'Enter a 10-digit mobile number')
const optionalPhone10 = z
  .string()
  .trim()
  .regex(PHONE10, 'Enter a 10-digit mobile number')
  .or(z.literal(''))
const text = z.string().trim()
const money = (msg: string) => z.coerce.number({ error: msg }).int(msg).positive(msg)

export const idProofSchema = z
  .object({
    id: z.string(),
    id_type: z.enum(ID_TYPES, { error: 'Choose the ID type' }),
    /** Empty when the number is already saved (only the last 4 digits are on the device). */
    id_number: text,
    id_last4: text,
  })
  .superRefine((p, ctx) => {
    if (!p.id_number && !p.id_last4) {
      ctx.addIssue({ code: 'custom', path: ['id_number'], message: 'Enter the ID number' })
    } else if (p.id_number) {
      const err = idError(p.id_type, p.id_number)
      if (err) ctx.addIssue({ code: 'custom', path: ['id_number'], message: err })
    }
  })

export const personSchema = z.object({
  id: z.string(),
  full_name: text.min(2, 'Enter the name'),
  phone: phone10,
  address: text,
  occupation: text,
  notes: text,
  id_proofs: z.array(idProofSchema).min(1, 'Add at least one ID proof'),
})

export const loanSchema = z.object({
  id: z.string(),
  loan_no: text.min(1, 'Enter the loan number'),
  amount: money('Enter the loan amount'),
  loan_date: z.iso.date('Enter the loan date'),
  tenure_months: z.coerce
    .number({ error: 'Enter the tenure' })
    .int('Whole months only')
    .min(1, 'At least 1 month')
    .max(120, 'At most 120 months'),
  installment_amount: money('Enter the monthly installment'),
  total_repayment: money('Enter the total repayment'),
  first_due_date: z.iso.date('Enter the first due date'),
  business_name: text,
  business_address: text,
  business_mobile: optionalPhone10,
  monthly_income: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number({ error: 'Numbers only' }).int().nonnegative().optional(),
  ),
  ref1_name: text.min(2, 'Enter reference name'),
  ref1_phone: phone10,
  ref1_address: text,
  ref2_name: text.min(2, 'Enter reference name'),
  ref2_phone: phone10,
  ref2_address: text,
  notes: text,
})

export type IdProofForm = z.input<typeof idProofSchema>
export type PersonForm = z.input<typeof personSchema>
export type PersonValues = z.output<typeof personSchema>
export type LoanForm = z.input<typeof loanSchema>
export interface ApplicationForm {
  loan: LoanForm
  borrower: PersonForm
  has_co_borrower: boolean
  co_borrower?: PersonForm
}

export const applicationSchema = z
  .object({
    loan: loanSchema,
    borrower: personSchema,
    has_co_borrower: z.boolean(),
    // Always present in the form; validated below only when the box is ticked.
    co_borrower: z.object({ id: z.string() }).loose().optional(),
  })
  .transform((a, ctx) => {
    let co: PersonValues | undefined
    if (a.has_co_borrower) {
      const r = personSchema.safeParse(a.co_borrower)
      if (!r.success) {
        for (const i of r.error.issues) {
          ctx.addIssue({ code: 'custom', message: i.message, path: ['co_borrower', ...i.path] })
        }
        return z.NEVER
      }
      co = r.data
    }
    const taken = new Set([a.borrower.phone, co?.phone])
    for (const key of ['ref1_phone', 'ref2_phone'] as const) {
      if (taken.has(a.loan[key])) {
        ctx.addIssue({
          code: 'custom',
          path: ['loan', key],
          message: 'A reference cannot be the borrower or co-borrower',
        })
      }
    }
    if (a.loan.ref1_phone === a.loan.ref2_phone) {
      ctx.addIssue({
        code: 'custom',
        path: ['loan', 'ref2_phone'],
        message: 'Two different references',
      })
    }
    return { ...a, co_borrower: co }
  })

export type ApplicationValues = z.output<typeof applicationSchema>

/** Form paths that belong to each step of the paper form, for step-by-step validation. */
export const STEP_PATHS: Record<number, (f: ApplicationForm) => string[]> = {
  1: () => [
    'loan.loan_no',
    'loan.amount',
    'loan.loan_date',
    'loan.tenure_months',
    'loan.installment_amount',
    'loan.total_repayment',
    'loan.first_due_date',
  ],
  2: () => ['borrower.full_name', 'borrower.phone', 'borrower.address', 'borrower.id_proofs'],
  3: (f) =>
    f.has_co_borrower
      ? [
          'co_borrower.full_name',
          'co_borrower.phone',
          'co_borrower.address',
          'co_borrower.id_proofs',
        ]
      : [],
  4: () => ['loan.business_mobile', 'loan.monthly_income'],
  5: () => [
    'loan.ref1_name',
    'loan.ref1_phone',
    'loan.ref1_address',
    'loan.ref2_name',
    'loan.ref2_phone',
    'loan.ref2_address',
  ],
  6: () => [],
}

export const emptyProof = (
  id: string,
  id_type: IdProofForm['id_type'] = 'aadhaar',
): IdProofForm => ({
  id,
  id_type,
  id_number: '',
  id_last4: '',
})

export const emptyPerson = (id: string): PersonForm => ({
  id,
  full_name: '',
  phone: '',
  address: '',
  occupation: '',
  notes: '',
  id_proofs: [],
})
