import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { FormProvider, useForm, useFormContext, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { openJSON, sealJSON } from '../lib/crypto'
import { addMonths } from '../lib/cards'
import { errorMessage, inr, loanLabel, nowISO, todayISO, uuid } from '../lib/format'
import {
  applicationSchema,
  emptyPerson,
  STEP_PATHS,
  type ApplicationForm,
  type ApplicationValues,
  type PersonForm,
} from '../lib/schemas'
import { saveApplication } from '../lib/save'
import { fromE164 } from '../lib/validators'
import type { IdProof, Person } from '../lib/types'
import {
  Badge,
  BottomBar,
  Button,
  Card,
  Chip,
  cx,
  Eyebrow,
  Field,
  Input,
  Notice,
  Page,
  Rule,
  SectionHeader,
  Textarea,
  TopBar,
} from '../components/ui'
import { IconChevron } from '../components/icons'
import {
  BusinessFields,
  LoanTerms,
  PersonFields,
  PersonPicker,
  ReferenceFields,
  useVerified,
  VerifiedPill,
} from '../components/fields'
import { PhotoMulti } from '../components/PhotoTile'

const TITLES = [
  'Loan details',
  'Borrower',
  'Co-borrower',
  'Occupation and business',
  'References',
  'Signed form',
]
const NEXT = [
  'Next · Borrower',
  'Next · Co-borrower',
  'Next · Business',
  'Next · References',
  'Next · Signed form',
  'Save application',
]

async function nextLoanNo(): Promise<string> {
  const loans = await db.loans.toArray()
  const max = loans.reduce((m, l) => Math.max(m, Number.parseInt(l.loan_no, 10) || 0), 0)
  return String(max + 1)
}

function pickedPerson(p: Person, proofs: IdProof[]): PersonForm {
  return {
    id: p.id,
    full_name: p.full_name,
    phone: fromE164(p.phone),
    address: p.address ?? '',
    occupation: p.occupation ?? '',
    notes: p.notes ?? '',
    id_proofs: proofs.map((x) => ({
      id: x.id,
      id_type: x.id_type,
      id_number: '',
      id_last4: x.id_last4 ?? '',
    })),
  }
}

async function loadPerson(id: string): Promise<PersonForm | null> {
  const p = await db.people.get(id)
  if (!p || p.deleted_at) return null
  const proofs = await db.id_proofs
    .where('person_id')
    .equals(id)
    .filter((x) => !x.deleted_at)
    .toArray()
  return pickedPerson(p, proofs)
}

export function NewApplication() {
  const { step: stepParam } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const step = Math.min(6, Math.max(1, Number(stepParam) || 1))
  const draftId = useMemo(() => params.get('draft') ?? uuid(), [params])
  const [initial, setInitial] = useState<ApplicationForm | null>(null)

  useEffect(() => {
    if (!params.get('draft')) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('draft', draftId)
          return next
        },
        { replace: true },
      )
      return
    }
    void (async () => {
      const draft = await db.drafts.get(draftId)
      if (draft) {
        setInitial(await openJSON<ApplicationForm>(draft.data))
        return
      }
      const today = todayISO()
      const borrower =
        (params.get('borrower') && (await loadPerson(params.get('borrower')!))) || null
      setInitial({
        loan: {
          id: uuid(),
          loan_no: await nextLoanNo(),
          amount: '' as unknown as number,
          loan_date: today,
          tenure_months: '' as unknown as number,
          installment_amount: '' as unknown as number,
          total_repayment: '' as unknown as number,
          first_due_date: addMonths(today, 1),
          business_name: '',
          business_address: '',
          business_mobile: '',
          monthly_income: '' as unknown as number,
          ref1_name: '',
          ref1_phone: '',
          ref1_address: '',
          ref2_name: '',
          ref2_phone: '',
          ref2_address: '',
          notes: '',
        },
        borrower: borrower ?? emptyPerson(uuid()),
        has_co_borrower: false,
        co_borrower: emptyPerson(uuid()),
      })
    })()
  }, [draftId, params, setParams])

  if (!initial) return <TopBar title="New application" close={() => navigate('/')} />
  return <Wizard key={draftId} draftId={draftId} initial={initial} step={step} />
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <span
          key={i}
          className={cx('h-1 flex-1 rounded-full', i <= step ? 'bg-ink' : 'bg-rule-2')}
        />
      ))}
    </div>
  )
}

function Wizard({
  draftId,
  initial,
  step,
}: {
  draftId: string
  initial: ApplicationForm
  step: number
}) {
  const navigate = useNavigate()
  const form = useForm<ApplicationForm, unknown, ApplicationValues>({
    // The schema's input type is looser than the form (co-borrower validated in a transform).
    resolver: zodResolver(applicationSchema) as Resolver<
      ApplicationForm,
      unknown,
      ApplicationValues
    >,
    defaultValues: initial,
    mode: 'onBlur',
  })
  const { register, watch, setValue, getValues, trigger, handleSubmit } = form
  const hasCo = watch('has_co_borrower')
  const borrowerId = watch('borrower.id')
  const coId = watch('co_borrower.id')
  const loanId = watch('loan.id')
  const [invalid, setInvalid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Auto-save the draft (encrypted) on every change.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    const sub = watch((values) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void (async () =>
          db.drafts.put({
            id: draftId,
            title: values.borrower?.full_name || 'New application',
            data: await sealJSON(values),
            updated_at: nowISO(),
          }))()
      }, 500)
    })
    return () => {
      sub.unsubscribe()
      clearTimeout(timer.current)
    }
  }, [watch, draftId])

  useEffect(() => window.scrollTo({ top: 0 }), [step])

  const go = (s: number) => navigate(`/new/${s}?draft=${draftId}`)
  const next = async () => {
    setError(null)
    const paths = STEP_PATHS[step]!(getValues())
    if (paths.length && !(await trigger(paths as never[]))) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    go(step + 1)
  }
  const save = handleSubmit(
    async (values) => {
      setInvalid(false)
      setBusy(true)
      setError(null)
      try {
        const id = await saveApplication(values, draftId)
        navigate(`/loans/${id}`, { replace: true })
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        setBusy(false)
      }
    },
    () => setInvalid(true),
  )

  const pick = (block: 'borrower' | 'co_borrower') => async (p: Person) => {
    const proofs = await db.id_proofs
      .where('person_id')
      .equals(p.id)
      .filter((x) => !x.deleted_at)
      .toArray()
    setValue(block, pickedPerson(p, proofs), { shouldDirty: true })
  }

  return (
    <FormProvider {...form}>
      <TopBar
        close={() => navigate('/')}
        title="New application"
        subtitle="ऋण आवेदन पत्र"
        right={<Badge tone="grey">Saved on phone</Badge>}
      />
      <Page>
        <Progress step={step} />
        <div className="mt-3.5">
          <SectionHeader n={step} title={TITLES[step - 1]!} right={`${step} of 6`} />
        </div>
        <form className="mt-4 space-y-3.5" onSubmit={(e) => e.preventDefault()} noValidate>
          {step === 1 && (
            <>
              <LoanTerms prefix="loan." auto />
              <p className="text-[13px] leading-relaxed text-ink-3">
                Total is installment × months. Change it if the last installment is different.
              </p>
            </>
          )}
          {step === 2 && (
            <>
              <PersonPicker exclude={coId} onPick={(p) => void pick('borrower')(p)} />
              <PersonFields prefix="borrower." draftId={draftId} />
            </>
          )}
          {step === 3 && (
            <>
              <div className="flex gap-2">
                <Chip
                  active={!hasCo}
                  className="h-11 flex-1 justify-center"
                  onClick={() => setValue('has_co_borrower', false, { shouldDirty: true })}
                >
                  No co-borrower
                </Chip>
                <Chip
                  active={hasCo}
                  className="h-11 flex-1 justify-center"
                  onClick={() => setValue('has_co_borrower', true, { shouldDirty: true })}
                >
                  Add co-borrower
                </Chip>
              </div>
              {hasCo && (
                <>
                  <PersonPicker exclude={borrowerId} onPick={(p) => void pick('co_borrower')(p)} />
                  <PersonFields prefix="co_borrower." draftId={draftId} />
                </>
              )}
            </>
          )}
          {step === 4 && (
            <>
              <div className="flex gap-2.5">
                <Field label="Borrower occupation" className="flex-1">
                  <Input {...register('borrower.occupation')} />
                </Field>
                {hasCo && (
                  <Field label="Co-borrower occupation" className="flex-1">
                    <Input {...register('co_borrower.occupation')} />
                  </Field>
                )}
              </div>
              <BusinessFields prefix="loan." />
            </>
          )}
          {step === 5 && <ReferenceFields prefix="loan." />}
          {step === 6 && (
            <>
              <p className="text-sm leading-relaxed text-ink-3">
                Borrower and co-borrower sign or thumb the declaration on the paper. Photograph the
                signed page.
              </p>
              <PhotoMulti
                owner={{ loan_id: loanId }}
                type="signed_form"
                label="Signed page"
                addLabel="Photograph the signed page"
                draftId={draftId}
              />
              <Eyebrow className="pt-1">Review</Eyebrow>
              <Review draftId={draftId} go={go} />
              <Field label="Notes">
                <Textarea {...register('loan.notes')} />
              </Field>
            </>
          )}
          {invalid && (
            <Notice tone="error">Some fields need attention, they are marked above.</Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </form>
      </Page>
      <BottomBar>
        {step > 1 && (
          <Button variant="secondary" className="w-24" onClick={() => go(step - 1)} disabled={busy}>
            Back
          </Button>
        )}
        <Button
          className="flex-1"
          onClick={() => void (step === 6 ? save() : next())}
          disabled={busy}
        >
          {busy ? 'Saving…' : NEXT[step - 1]}
        </Button>
      </BottomBar>
    </FormProvider>
  )
}

function ReviewRow({
  label,
  value,
  onClick,
}: {
  label: string
  value: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink-2">{label}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          {value}
        </span>
      </span>
      <IconChevron size={20} className="shrink-0 text-ink-4" />
    </button>
  )
}

function Review({ draftId, go }: { draftId: string; go: (s: number) => void }) {
  const { control } = useFormContext<ApplicationForm>()
  const v = useWatch({ control })
  const loanId = v.loan?.id ?? ''
  const pages = useLiveQuery(
    () =>
      db.documents
        .where('loan_id')
        .equals(loanId)
        .filter((d) => d.type === 'signed_form' && !d.deleted_at)
        .count(),
    [loanId, draftId],
  )
  const bVerified = useVerified(v.borrower?.phone ?? '')
  const cVerified = useVerified(v.co_borrower?.phone ?? '')
  const missing = (t: string) => <span className="font-medium text-late">· {t}</span>
  const muted = (t: string) => <span className="font-medium text-ink-3">· {t}</span>
  const refs = [v.loan?.ref1_name, v.loan?.ref2_name].filter((n) => n && n.trim())
  return (
    <Card className="overflow-hidden">
      <ReviewRow
        label="Loan"
        onClick={() => go(1)}
        value={
          <>
            {loanLabel(v.loan?.loan_no ?? '')}
            {v.loan?.amount ? ` · ${inr(Number(v.loan.amount))}` : ''}
            {v.loan?.tenure_months && v.loan.installment_amount
              ? ` · ${v.loan.tenure_months} × ${inr(Number(v.loan.installment_amount))}`
              : missing('amounts missing')}
          </>
        }
      />
      <Rule className="mx-4" />
      <ReviewRow
        label="Borrower"
        onClick={() => go(2)}
        value={
          <>
            {v.borrower?.full_name || missing('name missing')}
            {bVerified ? <VerifiedPill /> : muted('mobile not verified')}
            {muted(
              `${v.borrower?.id_proofs?.length ?? 0} ID${(v.borrower?.id_proofs?.length ?? 0) === 1 ? '' : 's'}`,
            )}
          </>
        }
      />
      <Rule className="mx-4" />
      <ReviewRow
        label="Co-borrower"
        onClick={() => go(3)}
        value={
          v.has_co_borrower ? (
            <>
              {v.co_borrower?.full_name || missing('name missing')}
              {cVerified ? <VerifiedPill /> : muted('mobile not verified')}
            </>
          ) : (
            'None'
          )
        }
      />
      <Rule className="mx-4" />
      <ReviewRow
        label="Business"
        onClick={() => go(4)}
        value={v.loan?.business_name || muted('not filled')}
      />
      <Rule className="mx-4" />
      <ReviewRow
        label="References"
        onClick={() => go(5)}
        value={
          <>
            {refs.join(', ') || missing('none added')}
            {refs.length === 1 && missing('second reference missing')}
          </>
        }
      />
      <Rule className="mx-4" />
      <ReviewRow
        label="Signed form"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        value={
          pages ? `${pages} page${pages === 1 ? '' : 's'} photographed` : muted('not photographed')
        }
      />
    </Card>
  )
}
