import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { loanSummary } from '../lib/cards'
import {
  errorMessage,
  firstName,
  fmtDate,
  fmtDayMonth,
  inr,
  loanLabel,
  todayISO,
} from '../lib/format'
import { softDeleteWithFiles } from '../lib/save'
import { supabase } from '../lib/supabase'
import { hasBackSide, ID_LABELS, ID_SHORT } from '../lib/types'
import { fmtPhone, formatIdNumber, fromE164, maskId } from '../lib/validators'
import {
  Button,
  Card,
  cx,
  Eyebrow,
  IconButton,
  Notice,
  Page,
  Row,
  Rule,
  TopBar,
} from '../components/ui'
import { IconChevron, IconEye, IconPen, IconPhone, IconPlus, IconUser } from '../components/icons'
import { PhotoMulti, PhotoTile, useThumb } from '../components/PhotoTile'
import { useVerified, VerifiedPill } from '../components/fields'
import { MonthStrip } from '../components/ledger'
import { VerifyPhoneSheet } from '../components/VerifyPhoneSheet'

function PersonAvatar({ personId }: { personId: string }) {
  const doc = useLiveQuery(
    () =>
      db.documents
        .where('[person_id+type]')
        .equals([personId, 'person_photo'])
        .filter((d) => !d.deleted_at)
        .first(),
    [personId],
  )
  const url = useThumb(doc)
  return (
    <span className="inline-flex h-18 w-18 shrink-0 items-center justify-center overflow-hidden rounded-[20px] bg-tint text-ink-2">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <IconUser size={34} />
      )}
    </span>
  )
}

export function PersonDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const today = todayISO()
  const person = useLiveQuery(() => db.people.get(id), [id])
  const proofs = useLiveQuery(
    () =>
      db.id_proofs
        .where('person_id')
        .equals(id)
        .filter((p) => !p.deleted_at)
        .toArray(),
    [id],
  )
  const loans = useLiveQuery(
    () =>
      db.loans
        .filter((l) => !l.deleted_at && (l.borrower_id === id || l.co_borrower_id === id))
        .toArray(),
    [id],
  )
  const cards = useLiveQuery(
    () =>
      loans
        ? db.installments
            .where('loan_id')
            .anyOf(loans.map((l) => l.id))
            .toArray()
        : [],
    [loans],
  )
  const verified = useVerified(person ? fromE164(person.phone) : '')
  const [verify, setVerify] = useState(false)
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!revealed) return
    const t = setTimeout(() => setRevealed(null), 15_000)
    return () => clearTimeout(t)
  }, [revealed])

  if (person === undefined) return <TopBar back="/" />
  if (!person || person.deleted_at) {
    return (
      <>
        <TopBar back="/" />
        <Page>
          <p className="text-ink-3">This person was deleted.</p>
        </Page>
      </>
    )
  }

  const reveal = async (proofId: string) => {
    setRevealError(null)
    if (!navigator.onLine) return setRevealError('Showing the full number needs internet.')
    const { data, error } = await supabase.rpc('reveal_id', { p_id_proof_id: proofId })
    if (error) setRevealError(error.message)
    else setRevealed({ id: proofId, value: (data as string | null) ?? '' })
  }

  const remove = async () => {
    if (loans?.length) return alert('Delete or settle their loans first.')
    if (!confirm(`Delete ${person.full_name} and their photos?`)) return
    setBusy(true)
    try {
      await softDeleteWithFiles('person', person.id)
      navigate('/', { replace: true })
    } catch (e) {
      alert(errorMessage(e))
      setBusy(false)
    }
  }

  const phone10 = fromE164(person.phone)

  return (
    <>
      <TopBar
        back="/"
        right={
          <Link
            to={`/people/${person.id}/edit`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink"
            aria-label="Edit"
          >
            <IconPen />
          </Link>
        }
      />
      <Page className="space-y-5">
        <section className="flex items-center gap-4">
          <PersonAvatar personId={person.id} />
          <div className="min-w-0">
            <h1 className="num text-[28px] leading-[1.05] font-bold">{person.full_name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a href={`tel:${person.phone}`} className="text-[15px] font-medium">
                {fmtPhone(person.phone)}
              </a>
              {verified ? (
                <VerifiedPill />
              ) : (
                <button
                  type="button"
                  onClick={() => setVerify(true)}
                  className="text-sm font-semibold text-ink underline decoration-rule-2 underline-offset-4"
                >
                  Verify
                </button>
              )}
              <IconButton
                aria-label="Call"
                className="h-9 w-9 border-[1.5px] border-rule-2 bg-white"
                onClick={() => (location.href = `tel:${person.phone}`)}
              >
                <IconPhone size={18} />
              </IconButton>
            </div>
          </div>
        </section>
        <VerifyPhoneSheet
          phone10={phone10}
          personId={person.id}
          open={verify}
          onClose={() => setVerify(false)}
        />

        <Card className="overflow-hidden">
          {proofs?.map((p) => (
            <div key={p.id}>
              <Row
                label={ID_LABELS[p.id_type]}
                value={
                  <span className="num text-lg font-semibold tracking-wide">
                    {revealed?.id === p.id
                      ? formatIdNumber(p.id_type, revealed.value) || 'not saved'
                      : maskId(p.id_type, p.id_last4)}
                  </span>
                }
                right={
                  revealed?.id !== p.id &&
                  p.id_last4 && (
                    <button
                      type="button"
                      onClick={() => void reveal(p.id)}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold"
                    >
                      <IconEye size={18} /> Reveal
                    </button>
                  )
                }
              />
              <Rule className="mx-4" />
            </div>
          ))}
          {proofs?.length === 0 && (
            <>
              <Row label="ID proofs" value={<span className="text-ink-3">None added</span>} />
              <Rule className="mx-4" />
            </>
          )}
          <Row label="Address" value={person.address ?? <span className="text-ink-3">—</span>} />
          <Rule className="mx-4" />
          <Row
            label="Occupation"
            value={person.occupation ?? <span className="text-ink-3">—</span>}
          />
          {person.notes && (
            <>
              <Rule className="mx-4" />
              <Row label="Notes" value={person.notes} />
            </>
          )}
        </Card>
        {revealError && <Notice tone="error">{revealError}</Notice>}

        <section>
          <Eyebrow className="mb-2.5">Photos</Eyebrow>
          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 [scrollbar-width:none]">
            <PhotoTile
              owner={{ person_id: person.id }}
              type="person_photo"
              label="Person"
              size={78}
            />
            {proofs?.map((p) => (
              <div key={p.id} className="flex gap-2.5">
                <PhotoTile
                  owner={{ person_id: person.id, id_proof_id: p.id }}
                  type="id_front"
                  label={ID_SHORT[p.id_type]}
                  size={78}
                />
                {hasBackSide(p.id_type) && (
                  <PhotoTile
                    owner={{ person_id: person.id, id_proof_id: p.id }}
                    type="id_back"
                    label="Back"
                    size={78}
                  />
                )}
              </div>
            ))}
            <PhotoMulti owner={{ person_id: person.id }} type="other" label="Other" size={78} />
          </div>
        </section>

        <section>
          <Eyebrow className="mb-2.5">Loans</Eyebrow>
          {!loans?.length ? (
            <p className="text-sm text-ink-3">No loans yet.</p>
          ) : (
            <Card className="overflow-hidden">
              {loans.map((l, i) => {
                const mine = cards?.filter((c) => c.loan_id === l.id) ?? []
                const s = loanSummary(l, mine, today)
                return (
                  <div key={l.id}>
                    <Link
                      to={`/loans/${l.id}`}
                      className={cx(
                        'flex items-center gap-3 px-4 py-3.5',
                        s.closed && 'opacity-70',
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="text-base font-semibold">
                          {loanLabel(l.loan_no)} · <span className="num">{inr(l.amount)}</span>
                          {l.co_borrower_id === person.id && (
                            <span className="ml-2 text-xs font-medium text-ink-3">co-borrower</span>
                          )}
                        </span>
                        <MonthStrip cards={mine} today={today} />
                        <span className="text-[13px] text-ink-3">
                          {s.closed
                            ? `Closed${l.settled_on ? ` ${fmtDate(l.settled_on)}` : ''}`
                            : `${inr(s.remaining)} remaining${s.nextDue ? ` · next due ${fmtDayMonth(s.nextDue.due_date)}` : ''}`}
                        </span>
                      </span>
                      <IconChevron size={20} className="text-ink-4" />
                    </Link>
                    {i < loans.length - 1 && <Rule className="mx-4" />}
                  </div>
                )
              })}
            </Card>
          )}
        </section>

        <Button
          variant="secondary"
          className="w-full"
          onClick={() => navigate(`/new/1?borrower=${person.id}`)}
        >
          <IconPlus size={20} /> New loan for {firstName(person.full_name)}
        </Button>
        <Button variant="danger" className="w-full" onClick={() => void remove()} disabled={busy}>
          Delete person
        </Button>
      </Page>
    </>
  )
}
