import { useState } from 'react'
import { useFieldArray, useFormContext, useWatch, type FieldErrors } from 'react-hook-form'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { addMonths } from '../lib/cards'
import { emptyProof, type IdProofForm } from '../lib/schemas'
import { hasBackSide, ID_LABELS, ID_SHORT, ID_TYPES, type IdType, type Person } from '../lib/types'
import { PHONE10, toE164, fromE164, formatIdNumber, maskId } from '../lib/validators'
import { firstName, uuid } from '../lib/format'
import { Button, Card, Chip, Eyebrow, Field, Input, Rule, Sheet, Textarea } from './ui'
import { IconChevron, IconIdCard, IconPlus, IconSearch, IconShield } from './icons'
import { PhotoTile } from './PhotoTile'
import { VerifyPhoneSheet } from './VerifyPhoneSheet'

// The field groups are used by the New-application steps (prefixed 'borrower.', 'loan.' …)
// and by the edit screens (no prefix), so paths are strings resolved at runtime.
type AnyForm = Record<string, unknown>

export function errAt(errors: FieldErrors<AnyForm>, path: string): string | undefined {
  const node = path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], errors)
  const n = node as { message?: string; root?: { message?: string } } | undefined
  return n?.message ?? n?.root?.message
}

export const Label = ({ children }: { children: string }) => (
  <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{children}</span>
)

export function useVerified(phone10: string) {
  const valid = PHONE10.test(phone10)
  return useLiveQuery(
    () => (valid ? db.phone_verifications.get(toE164(phone10)) : undefined),
    [phone10, valid],
  )
}

export const VerifiedPill = ({ tall }: { tall?: boolean }) => (
  <span
    className={
      tall
        ? 'inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-paid-bg px-3.5 text-sm font-semibold text-paid'
        : 'inline-flex h-6.5 items-center gap-1 rounded-full bg-paid-bg px-2.5 text-xs font-semibold text-paid'
    }
  >
    <IconShield size={tall ? 18 : 14} /> Verified
  </span>
)

export function PhoneField({
  path,
  label,
  personId,
  verify,
}: {
  path: string
  label: string
  personId?: string
  verify?: boolean
}) {
  const { register, watch, formState } = useFormContext<AnyForm>()
  const phone = String(watch(path) ?? '')
  const [open, setOpen] = useState(false)
  const valid = PHONE10.test(phone)
  const verified = useVerified(phone)
  return (
    <>
      <Field label={label} error={errAt(formState.errors, path)}>
        <div className="flex gap-2.5">
          <Input
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={10}
            className="flex-1"
            {...register(path)}
          />
          {verify &&
            (verified ? (
              <VerifiedPill tall />
            ) : (
              <Button
                variant="secondary"
                className="h-12 rounded-xl px-4 text-[15px]"
                disabled={!valid}
                onClick={() => setOpen(true)}
              >
                Verify
              </Button>
            ))}
        </div>
      </Field>
      {verify && (
        <VerifyPhoneSheet
          phone10={phone}
          personId={personId}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** Name, mobile, address, person photo and the ID proofs for one person. */
export function PersonFields({ prefix = '', draftId }: { prefix?: string; draftId?: string }) {
  const { register, watch, formState } = useFormContext<AnyForm>()
  const p = (k: string) => prefix + k
  const personId = String(watch(p('id')))
  const name = String(watch(p('full_name')) ?? '')
  const e = (k: string) => errAt(formState.errors, p(k))
  return (
    <>
      <Field label="Full name" error={e('full_name')}>
        <Input autoComplete="off" autoCapitalize="words" {...register(p('full_name'))} />
      </Field>
      <PhoneField path={p('phone')} label="Mobile" personId={personId} verify />
      <Field label="Address" error={e('address')}>
        <Textarea {...register(p('address'))} />
      </Field>
      <div>
        <Label>Person photo</Label>
        <PhotoTile
          owner={{ person_id: personId }}
          type="person_photo"
          label={name.trim() ? firstName(name) : 'Take photo'}
          draftId={draftId}
        />
      </div>
      <IdProofsField prefix={prefix} personId={personId} draftId={draftId} />
    </>
  )
}

function IdProofRow({ path, onClick }: { path: string; onClick: () => void }) {
  const v = useWatch({ name: path }) as IdProofForm | undefined
  const docs = useLiveQuery(
    () =>
      v?.id
        ? db.documents
            .where('id_proof_id')
            .equals(v.id)
            .filter((d) => !d.deleted_at)
            .toArray()
        : [],
    [v?.id],
  )
  if (!v) return null
  const type = (v.id_type || 'aadhaar') as IdType
  const number = v.id_number ? formatIdNumber(type, v.id_number) : maskId(type, v.id_last4 || null)
  const front = docs?.some((d) => d.type === 'id_front')
  const back = docs?.some((d) => d.type === 'id_back')
  const photos =
    front && (back || !hasBackSide(type))
      ? hasBackSide(type)
        ? 'Front and back photographed'
        : 'Front photographed'
      : front
        ? 'Front photographed · back missing'
        : back
          ? 'Back photographed · front missing'
          : 'No photos yet'
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-tint text-ink-2">
        <IconIdCard size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">
          {ID_SHORT[type]} · <span className="num tracking-wide">{number}</span>
        </span>
        <span className="block text-xs text-ink-3">{photos}</span>
      </span>
      <IconChevron size={20} className="text-ink-4" />
    </button>
  )
}

const HINT: Record<IdType, string> = {
  aadhaar: '12 digits, as printed on the card',
  pan: '10 characters, the fourth letter is P for a person',
  voter_id: '3 letters and 7 digits, like ABC1234567',
  driving_licence: 'As printed on the licence',
}

/** Edits one entry of the ID proofs list. */
function IdProofSheet({
  path,
  personId,
  draftId,
  onClose,
  onRemove,
}: {
  path: string | null
  personId: string
  draftId?: string
  onClose: () => void
  onRemove: () => void
}) {
  const { register, watch, setValue, trigger, formState } = useFormContext<AnyForm>()
  const base = path ?? '__none__'
  const type = ((watch(`${base}.id_type`) as IdType | undefined) ?? 'aadhaar') as IdType
  const id = String(watch(`${base}.id`) ?? '')
  const last4 = String(watch(`${base}.id_last4`) ?? '')
  const done = async () => {
    if (path && !(await trigger(path))) return
    onClose()
  }
  return (
    <Sheet open={path !== null} onClose={() => void done()} title="ID proof">
      <div className="space-y-4">
        <div>
          <Label>Type</Label>
          <div className="flex flex-wrap gap-2">
            {ID_TYPES.map((t) => (
              <Chip
                key={t}
                active={type === t}
                onClick={() =>
                  path && setValue(`${path}.id_type`, t as never, { shouldDirty: true })
                }
              >
                {ID_SHORT[t]}
              </Chip>
            ))}
          </div>
        </div>
        <Field
          label={`${ID_LABELS[type]} number`}
          error={path ? errAt(formState.errors, `${path}.id_number`) : undefined}
          hint={last4 ? `Saved as ${maskId(type, last4)}. Leave blank to keep it.` : HINT[type]}
        >
          <Input
            autoComplete="off"
            autoCapitalize="characters"
            inputMode={type === 'aadhaar' ? 'numeric' : 'text'}
            placeholder={last4 ? maskId(type, last4) : ''}
            className="num tracking-wide"
            {...register(`${base}.id_number`)}
          />
        </Field>
        <div>
          <Label>Photos</Label>
          <div className="flex items-center gap-2.5">
            {id && (
              <PhotoTile
                owner={{ person_id: personId, id_proof_id: id }}
                type="id_front"
                label="Front"
                draftId={draftId}
              />
            )}
            {id && hasBackSide(type) ? (
              <PhotoTile
                owner={{ person_id: personId, id_proof_id: id }}
                type="id_back"
                label="Back"
                draftId={draftId}
              />
            ) : (
              <p className="max-w-40 text-xs text-ink-3">PAN has no back side.</p>
            )}
          </div>
        </div>
        <div className="flex gap-2.5">
          <Button variant="danger" className="w-28" onClick={onRemove}>
            Remove
          </Button>
          <Button className="flex-1" onClick={() => void done()}>
            Done
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/** The list of ID proofs a person handed over, each edited in a sheet. */
export function IdProofsField({
  prefix = '',
  personId,
  draftId,
}: {
  prefix?: string
  personId: string
  draftId?: string
}) {
  const { control, formState } = useFormContext<AnyForm>()
  const name = prefix + 'id_proofs'
  // Paths are runtime strings, so the array helpers are typed loosely here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { fields, append, remove } = useFieldArray({ control: control as any, name: name as any })
  const [editing, setEditing] = useState<number | null>(null)
  const error = errAt(formState.errors, name)

  const removeAt = async (i: number) => {
    const entry = fields[i] as unknown as IdProofForm | undefined
    remove(i)
    setEditing(null)
    if (!entry?.id) return
    // Photos taken for this entry inside the draft are dropped with it; saved ones go at save time.
    const docs = await db.documents
      .where('id_proof_id')
      .equals(entry.id)
      .filter((d) => Boolean(d.draft_id))
      .toArray()
    await db.transaction('rw', db.documents, db.blobs, async () => {
      await db.documents.bulkDelete(docs.map((d) => d.id))
      await db.blobs.bulkDelete(docs.map((d) => d.id))
    })
  }

  return (
    <div>
      <Label>ID proofs</Label>
      <Card className="overflow-hidden">
        {fields.map((f, i) => (
          <div key={f.id}>
            <IdProofRow path={`${name}.${i}`} onClick={() => setEditing(i)} />
            <Rule className="mx-3.5" />
          </div>
        ))}
        <button
          type="button"
          className="flex min-h-13 w-full items-center justify-center gap-2 px-3.5 text-[15px] font-semibold text-ink"
          onClick={() => {
            append(emptyProof(uuid()))
            setEditing(fields.length)
          }}
        >
          <IconPlus size={20} /> {fields.length ? 'Add another ID' : 'Add an ID'}
        </button>
      </Card>
      {error && <p className="mt-1 text-[13px] text-late">{error}</p>}
      <IdProofSheet
        path={editing !== null ? `${name}.${editing}` : null}
        personId={personId}
        draftId={draftId}
        onClose={() => setEditing(null)}
        onRemove={() => editing !== null && void removeAt(editing)}
      />
    </div>
  )
}

/** Search box over existing people; picking one prefills a person block. */
export function PersonPicker({
  onPick,
  exclude,
}: {
  onPick: (p: Person) => void
  exclude?: string
}) {
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const matches = useLiveQuery(
    () =>
      term.length < 2
        ? Promise.resolve([] as Person[])
        : db.people
            .filter(
              (p) =>
                !p.deleted_at &&
                p.id !== exclude &&
                (p.full_name.toLowerCase().includes(term) || fromE164(p.phone).includes(term)),
            )
            .limit(8)
            .toArray(),
    [term, exclude],
  )
  return (
    <div>
      <label className="flex min-h-12 items-center gap-2.5 rounded-xl bg-tint-2 px-3.5 text-ink-3">
        <IconSearch size={20} />
        <input
          className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-4 focus:outline-none"
          placeholder="Find an existing person"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
      </label>
      {matches && matches.length > 0 && (
        <Card className="mt-2 overflow-hidden">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 border-b border-rule px-3.5 py-3 text-left text-[15px] last:border-b-0"
              onClick={() => {
                onPick(p)
                setQ('')
              }}
            >
              <span className="font-medium">{p.full_name}</span>
              <span className="text-ink-3">{fromE164(p.phone)}</span>
            </button>
          ))}
        </Card>
      )}
    </div>
  )
}

/** Section 1 of the paper: loan number, amount, date, tenure, installment, total. */
export function LoanTerms({
  prefix = '',
  auto,
  locked,
}: {
  prefix?: string
  auto: boolean
  locked?: boolean
}) {
  const { register, watch, setValue, formState } = useFormContext<AnyForm>()
  const p = (k: string) => prefix + k
  const e = (k: string) => errAt(formState.errors, p(k))
  const installment = Number(watch(p('installment_amount')) || 0)
  const tenure = Number(watch(p('tenure_months')) || 0)
  const loanDate = String(watch(p('loan_date')) ?? '')
  const dirtyFields = formState.dirtyFields // read during render so react-hook-form tracks it
  const dirty = (k: string) =>
    Boolean(
      p(k)
        .split('.')
        .reduce<unknown>((o, s) => (o as Record<string, unknown> | undefined)?.[s], dirtyFields),
    )

  if (auto && !dirty('total_repayment') && installment > 0 && tenure > 0) {
    const want = installment * tenure
    if (Number(watch(p('total_repayment')) || 0) !== want) setValue(p('total_repayment'), want)
  }
  if (auto && !dirty('first_due_date') && /^\d{4}-\d{2}-\d{2}$/.test(loanDate)) {
    const want = addMonths(loanDate, 1)
    if (watch(p('first_due_date')) !== want) setValue(p('first_due_date'), want)
  }

  const expected = installment * tenure
  const total = Number(watch(p('total_repayment')) || 0)
  const totalHint =
    expected > 0 && total > 0 && Math.abs(total - expected) > installment
      ? `Differs from ${tenure} × installment (₹${expected.toLocaleString('en-IN')}); the last card absorbs the difference.`
      : undefined

  return (
    <>
      <div className="flex gap-2.5">
        <Field label="Loan no." error={e('loan_no')} className="flex-1">
          <Input autoComplete="off" {...register(p('loan_no'))} />
        </Field>
        <Field label="Loan date" error={e('loan_date')} className="flex-1">
          <Input type="date" disabled={locked} {...register(p('loan_date'))} />
        </Field>
      </div>
      <div className="flex gap-2.5">
        <Field label="Loan amount ₹" error={e('amount')} className="flex-1">
          <Input inputMode="numeric" disabled={locked} {...register(p('amount'))} />
        </Field>
        <Field label="Months" error={e('tenure_months')} className="flex-1">
          <Input inputMode="numeric" disabled={locked} {...register(p('tenure_months'))} />
        </Field>
      </div>
      <div className="flex gap-2.5">
        <Field label="Monthly installment ₹" error={e('installment_amount')} className="flex-1">
          <Input inputMode="numeric" disabled={locked} {...register(p('installment_amount'))} />
        </Field>
        <Field label="Total repayment ₹" error={e('total_repayment')} className="flex-1">
          <Input inputMode="numeric" disabled={locked} {...register(p('total_repayment'))} />
        </Field>
      </div>
      <Field label="First installment due" error={e('first_due_date')} hint={totalHint}>
        <Input type="date" disabled={locked} {...register(p('first_due_date'))} />
      </Field>
    </>
  )
}

/** Section 4 of the paper (occupations live on the person blocks). */
export function BusinessFields({ prefix = '' }: { prefix?: string }) {
  const { register, formState } = useFormContext<AnyForm>()
  const p = (k: string) => prefix + k
  return (
    <>
      <Field label="Business / workplace name">
        <Input {...register(p('business_name'))} />
      </Field>
      <Field label="Business / work address">
        <Textarea {...register(p('business_address'))} />
      </Field>
      <div className="flex gap-2.5">
        <div className="flex-1">
          <PhoneField path={p('business_mobile')} label="Business mobile" />
        </div>
        <Field
          label="Approx. monthly income ₹"
          error={errAt(formState.errors, p('monthly_income'))}
          className="flex-1"
        >
          <Input inputMode="numeric" {...register(p('monthly_income'))} />
        </Field>
      </div>
    </>
  )
}

/** Section 5 of the paper: two references. */
export function ReferenceFields({ prefix = '' }: { prefix?: string }) {
  const { register, formState } = useFormContext<AnyForm>()
  const p = (k: string) => prefix + k
  return (
    <>
      {([1, 2] as const).map((n) => (
        <div key={n} className="space-y-3.5">
          {n === 2 && <Rule className="my-1" />}
          <Eyebrow>Reference {n}</Eyebrow>
          <Field label="Name" error={errAt(formState.errors, p(`ref${n}_name`))}>
            <Input autoCapitalize="words" {...register(p(`ref${n}_name`))} />
          </Field>
          <PhoneField path={p(`ref${n}_phone`)} label="Mobile" />
          <Field label="Full address">
            <Textarea {...register(p(`ref${n}_address`))} />
          </Field>
        </div>
      ))}
    </>
  )
}
