import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { FormProvider, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { db } from '../lib/db'
import { errorMessage, loanLabel } from '../lib/format'
import { loanSchema, type LoanForm } from '../lib/schemas'
import { loanFromForm, saveLoan } from '../lib/save'
import { fromE164 } from '../lib/validators'
import type { Loan } from '../lib/types'
import {
  BottomBar,
  Button,
  Field,
  Notice,
  Page,
  SectionHeader,
  Textarea,
  TopBar,
} from '../components/ui'
import { BusinessFields, LoanTerms, ReferenceFields } from '../components/fields'

type Values = z.output<typeof loanSchema>

const SCHEDULE_KEYS = [
  'amount',
  'tenure_months',
  'installment_amount',
  'total_repayment',
  'first_due_date',
] as const

export function LoanEdit() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [loan, setLoan] = useState<Loan | null>(null)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const l = await db.loans.get(id)
      if (!l) return navigate('/', { replace: true })
      setLocked(
        (await db.installments.where('loan_id').equals(id).toArray()).some(
          (c) => c.paid_amount > 0,
        ),
      )
      setLoan(l)
    })()
  }, [id, navigate])

  if (!loan) return <TopBar title="Edit loan" close={() => navigate(`/loans/${id}`)} />

  const initial: LoanForm = {
    id: loan.id,
    loan_no: loan.loan_no,
    amount: loan.amount,
    loan_date: loan.loan_date,
    tenure_months: loan.tenure_months,
    installment_amount: loan.installment_amount,
    total_repayment: loan.total_repayment,
    first_due_date: loan.first_due_date,
    business_name: loan.business_name ?? '',
    business_address: loan.business_address ?? '',
    business_mobile: loan.business_mobile ? fromE164(loan.business_mobile) : '',
    monthly_income: loan.monthly_income ?? ('' as unknown as number),
    ref1_name: loan.ref1_name,
    ref1_phone: fromE164(loan.ref1_phone),
    ref1_address: loan.ref1_address ?? '',
    ref2_name: loan.ref2_name,
    ref2_phone: fromE164(loan.ref2_phone),
    ref2_address: loan.ref2_address ?? '',
    notes: loan.notes ?? '',
  }

  return (
    <Form
      initial={initial}
      locked={locked}
      error={error}
      onSave={async (v) => {
        try {
          const next = loanFromForm(
            v,
            { borrower_id: loan.borrower_id, co_borrower_id: loan.co_borrower_id },
            loan.updated_at,
            loan,
          )
          const regenerate = !locked && SCHEDULE_KEYS.some((k) => next[k] !== loan[k])
          await saveLoan(next, regenerate)
          navigate(`/loans/${loan.id}`, { replace: true })
        } catch (e) {
          setError(errorMessage(e))
        }
      }}
    />
  )
}

function Form({
  initial,
  locked,
  error,
  onSave,
}: {
  initial: LoanForm
  locked: boolean
  error: string | null
  onSave: (v: Values) => Promise<void>
}) {
  const navigate = useNavigate()
  const form = useForm<LoanForm, unknown, Values>({
    resolver: zodResolver(loanSchema),
    defaultValues: initial,
    mode: 'onBlur',
  })
  const [invalid, setInvalid] = useState(false)
  return (
    <FormProvider {...form}>
      <TopBar
        title="Edit loan"
        subtitle={loanLabel(initial.loan_no)}
        close={() => navigate(`/loans/${initial.id}`)}
      />
      <Page>
        <form
          id="loan-edit"
          onSubmit={form.handleSubmit(
            (v) => {
              setInvalid(false)
              return onSave(v)
            },
            () => setInvalid(true),
          )}
          noValidate
          className="space-y-3.5"
        >
          {locked && (
            <Notice tone="info">
              Payments have been recorded, so the amounts and dates are locked. Undo the payments to
              change them.
            </Notice>
          )}
          <SectionHeader n={1} title="Loan details" />
          <LoanTerms auto={false} locked={locked} />
          <div className="pt-2">
            <SectionHeader n={4} title="Occupation and business" />
          </div>
          <BusinessFields />
          <div className="pt-2">
            <SectionHeader n={5} title="References" />
          </div>
          <ReferenceFields />
          <Field label="Notes">
            <Textarea {...form.register('notes')} />
          </Field>
          {invalid && (
            <Notice tone="error">Some fields need attention, they are marked above.</Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </form>
      </Page>
      <BottomBar>
        <Button
          type="submit"
          form="loan-edit"
          className="flex-1"
          disabled={form.formState.isSubmitting}
        >
          Save changes
        </Button>
      </BottomBar>
    </FormProvider>
  )
}
