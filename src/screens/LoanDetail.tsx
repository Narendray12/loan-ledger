import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { loanSummary } from '../lib/cards'
import {
  errorMessage,
  fmtDate,
  fmtDayMonth,
  inr,
  loanLabel,
  monthLabel,
  monthYear,
  todayISO,
} from '../lib/format'
import { saveInstallment, saveLoan, softDeleteWithFiles } from '../lib/save'
import { supabase } from '../lib/supabase'
import { fmtPhone, fromE164 } from '../lib/validators'
import type { Installment, Loan, PaidMode, Person } from '../lib/types'
import {
  BottomBar,
  Button,
  Card,
  Chip,
  cx,
  Eyebrow,
  Field,
  IconButton,
  Input,
  Page,
  Row,
  Rule,
  Sheet,
  Textarea,
  TopBar,
} from '../components/ui'
import { IconChevron, IconDoc, IconDots, IconPhone } from '../components/icons'
import { InstallmentTile, MonthStrip } from '../components/ledger'
import { PhotoMulti } from '../components/PhotoTile'

const MODES: { value: PaidMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank' },
  { value: 'other', label: 'Other' },
]

function MarkPaidSheet({
  card,
  who,
  loan,
  onClose,
}: {
  card: Installment | null
  who: string
  loan: Loan
  onClose: () => void
}) {
  const remaining = card ? card.amount_due - card.paid_amount : 0
  return (
    <Sheet
      open={card !== null}
      onClose={onClose}
      title={card ? `${monthLabel(card.due_date)} installment` : ''}
      subtitle={
        card ? `${who} · ${loanLabel(loan.loan_no)} · due ${fmtDayMonth(card.due_date)}` : undefined
      }
    >
      {card && <MarkPaidForm key={card.id} card={card} remaining={remaining} onClose={onClose} />}
    </Sheet>
  )
}

function MarkPaidForm({
  card,
  remaining,
  onClose,
}: {
  card: Installment
  remaining: number
  onClose: () => void
}) {
  const [amount, setAmount] = useState(String(remaining))
  const [date, setDate] = useState(todayISO())
  const [mode, setMode] = useState<PaidMode>('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const add = Number(amount || 0)

  const save = async () => {
    if (!(add > 0)) return
    setBusy(true)
    try {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
      await saveInstallment(card, {
        paid_amount: card.paid_amount + add,
        paid_on: date,
        paid_mode: mode,
        note: note.trim() || card.note,
        marked_by: data.user?.id ?? card.marked_by,
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1 block text-[13px] font-medium text-ink-2">Amount received</span>
        <div className="flex items-baseline gap-2.5 border-b-2 border-ink pb-2">
          <span className="num text-[44px] leading-none font-bold">₹</span>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            className="num min-w-0 flex-1 bg-transparent text-[44px] leading-none font-bold focus:outline-none"
            aria-label="Amount received"
          />
          <span className="shrink-0 text-sm text-ink-3">of {inr(remaining)}</span>
        </div>
      </div>
      <Field label="Received on">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Received as</span>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <Chip
              key={m.value}
              active={mode === m.value}
              onClick={() => setMode(m.value)}
              className="h-10 px-4"
            >
              {m.label}
            </Chip>
          ))}
        </div>
      </div>
      <Input placeholder="Note, if any" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button className="w-full" onClick={() => void save()} disabled={busy || !(add > 0)}>
        Save payment
      </Button>
    </div>
  )
}

function PaidSheet({ card, onClose }: { card: Installment | null; onClose: () => void }) {
  const undo = async () => {
    if (!card) return
    await saveInstallment(card, { paid_amount: 0, paid_on: null, paid_mode: null })
    onClose()
  }
  return (
    <Sheet
      open={card !== null}
      onClose={onClose}
      title={card ? `${monthLabel(card.due_date)} installment` : ''}
      subtitle={card ? `Due ${fmtDate(card.due_date)}` : undefined}
    >
      {card && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-paid-bg px-4 py-3 text-paid">
            <span className="num text-2xl font-bold">{inr(card.paid_amount)}</span>
            <span className="ml-2 text-sm font-medium">
              paid{card.paid_on ? ` on ${fmtDate(card.paid_on)}` : ''}
              {card.paid_mode ? ` · ${card.paid_mode}` : ''}
            </span>
            {card.note && <p className="mt-1 text-sm">{card.note}</p>}
          </div>
          <div className="flex gap-2.5">
            <Button variant="danger" className="w-32" onClick={() => void undo()}>
              Undo payment
            </Button>
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

export function LoanDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const today = todayISO()
  const loan = useLiveQuery(() => db.loans.get(id), [id])
  const cards = useLiveQuery(() => db.installments.where('loan_id').equals(id).sortBy('no'), [id])
  const borrower = useLiveQuery(
    () => (loan ? db.people.get(loan.borrower_id) : undefined),
    [loan?.borrower_id],
  )
  const co = useLiveQuery(
    () => (loan?.co_borrower_id ? db.people.get(loan.co_borrower_id) : undefined),
    [loan?.co_borrower_id],
  )
  const pages = useLiveQuery(
    () =>
      db.documents
        .where('loan_id')
        .equals(id)
        .filter((d) => d.type === 'signed_form' && !d.deleted_at)
        .sortBy('captured_at'),
    [id],
  )
  const [marking, setMarking] = useState<Installment | null>(null)
  const [paidOpen, setPaidOpen] = useState<Installment | null>(null)
  const [menu, setMenu] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [settling, setSettling] = useState(false)
  const [settleDate, setSettleDate] = useState(today)
  const [settleNote, setSettleNote] = useState('')

  if (loan === undefined || cards === undefined) return <TopBar back="/" />
  if (!loan || loan.deleted_at) {
    return (
      <>
        <TopBar back="/" />
        <Page>
          <p className="text-ink-3">This loan was deleted.</p>
        </Page>
      </>
    )
  }

  const s = loanSummary(loan, cards, today)
  const anyPaid = cards.some((c) => c.paid_amount > 0)
  const nextCard = cards.find((c) => c.paid_amount < c.amount_due) ?? null
  const first = cards[0]
  const last = cards[cards.length - 1]

  const settle = async () => {
    await saveLoan(
      {
        ...loan,
        settled_on: settleDate,
        notes:
          [loan.notes, settleNote.trim() && `Settled: ${settleNote.trim()}`]
            .filter(Boolean)
            .join('\n') || null,
      },
      false,
    )
    setSettling(false)
  }

  const reopen = async () => {
    if (!confirm('Reopen this loan?')) return
    await saveLoan({ ...loan, settled_on: null }, false)
    setMenu(false)
  }

  const remove = async () => {
    if (anyPaid) return alert('A loan with payments cannot be deleted. Settle it instead.')
    if (!confirm(`Delete loan ${loanLabel(loan.loan_no)}?`)) return
    try {
      await softDeleteWithFiles('loan', loan.id)
      navigate(`/people/${loan.borrower_id}`, { replace: true })
    } catch (e) {
      alert(errorMessage(e))
    }
  }

  const personLink = (p: Person | undefined) =>
    p && (
      <Link to={`/people/${p.id}`} className="underline decoration-rule-2 underline-offset-4">
        {p.full_name} · {fmtPhone(p.phone)}
      </Link>
    )

  return (
    <>
      <TopBar
        back={`/people/${loan.borrower_id}`}
        title={borrower?.full_name ?? '…'}
        subtitle={`Loan ${loanLabel(loan.loan_no)}`}
        right={
          <IconButton aria-label="More" onClick={() => setMenu(true)}>
            <IconDots />
          </IconButton>
        }
      />
      <Page className="space-y-5">
        <section>
          <div className="flex items-baseline gap-2.5 border-b-[1.5px] border-ink pb-2">
            <span className="num text-[38px] leading-none font-bold">{inr(loan.amount)}</span>
            <span className="text-sm font-medium text-ink-3">
              {loan.tenure_months} months · {inr(loan.installment_amount)} monthly
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3">
            <div className="border-r border-rule pr-3">
              <Eyebrow>Paid</Eyebrow>
              <p className="num mt-0.5 text-xl font-bold text-paid">{inr(s.paid)}</p>
            </div>
            <div className="border-r border-rule px-3">
              <Eyebrow>Remaining</Eyebrow>
              <p className="num mt-0.5 text-xl font-bold">{inr(s.remaining)}</p>
            </div>
            <div className="pl-3">
              <Eyebrow>{s.closed ? 'Status' : 'Next due'}</Eyebrow>
              <p className="num mt-0.5 text-xl font-bold">
                {s.closed
                  ? loan.settled_on
                    ? 'Settled'
                    : 'Closed'
                  : s.nextDue
                    ? fmtDayMonth(s.nextDue.due_date)
                    : '—'}
              </p>
            </div>
          </div>
          <div className="mt-3.5">
            <MonthStrip cards={cards} today={today} size="lg" />
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between">
            <Eyebrow>
              Installments
              {first && last ? ` · ${monthYear(first.due_date)} – ${monthYear(last.due_date)}` : ''}
            </Eyebrow>
            <span className="text-xs text-ink-3">
              {s.paidCards} of {cards.length} paid
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {cards.map((c, i) => (
              <InstallmentTile
                key={c.id}
                card={c}
                prev={cards[i - 1]}
                today={today}
                onClick={() => (c.paid_amount >= c.amount_due ? setPaidOpen(c) : setMarking(c))}
              />
            ))}
          </div>
        </section>

        <Card className="overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
            onClick={() => setShowForm((v) => !v)}
          >
            <span className="inline-flex h-14 w-11 shrink-0 items-center justify-center rounded-md border border-paid-line bg-tint text-ink-2">
              <IconDoc size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Signed form</span>
              <span className="block text-[13px] text-ink-3">
                {pages?.length
                  ? `Photographed ${fmtDate(pages[0]!.captured_at)} · ${pages.length} page${pages.length === 1 ? '' : 's'}`
                  : 'Not photographed yet'}
              </span>
            </span>
            <IconChevron
              size={20}
              className={cx('text-ink-4 transition', showForm && 'rotate-90')}
            />
          </button>
          {showForm && (
            <div className="px-3.5 pb-3.5">
              <PhotoMulti owner={{ loan_id: loan.id }} type="signed_form" label="Signed page" />
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <Row label="Borrower" value={personLink(borrower)} />
          {co && (
            <>
              <Rule className="mx-4" />
              <Row label="Co-borrower" value={personLink(co)} />
            </>
          )}
          <Rule className="mx-4" />
          <Row label="Loan date" value={fmtDate(loan.loan_date)} />
          <Rule className="mx-4" />
          <Row label="Total repayment" value={inr(loan.total_repayment)} />
          {(loan.business_name ||
            loan.business_address ||
            loan.business_mobile ||
            loan.monthly_income !== null) && (
            <>
              <Rule className="mx-4" />
              <Row
                label="Occupation and business"
                value={[
                  borrower?.occupation && `${borrower.full_name}: ${borrower.occupation}`,
                  co?.occupation && `${co.full_name}: ${co.occupation}`,
                  loan.business_name,
                  loan.business_address,
                  loan.business_mobile && fromE164(loan.business_mobile),
                  loan.monthly_income !== null && `${inr(loan.monthly_income)} a month`,
                ]
                  .filter(Boolean)
                  .join('\n')}
              />
            </>
          )}
          <Rule className="mx-4" />
          <Row
            label="References"
            value={`${loan.ref1_name} · ${fromE164(loan.ref1_phone)}${loan.ref1_address ? `\n${loan.ref1_address}` : ''}\n${loan.ref2_name} · ${fromE164(loan.ref2_phone)}${loan.ref2_address ? `\n${loan.ref2_address}` : ''}`}
          />
          {loan.notes && (
            <>
              <Rule className="mx-4" />
              <Row label="Notes" value={loan.notes} />
            </>
          )}
        </Card>
      </Page>

      <BottomBar>
        <Button
          variant="secondary"
          className="w-13 px-0"
          aria-label="Call borrower"
          onClick={() => borrower && (location.href = `tel:${borrower.phone}`)}
        >
          <IconPhone size={22} />
        </Button>
        {nextCard && !loan.settled_on ? (
          <Button className="flex-1" onClick={() => setMarking(nextCard)}>
            Mark {monthLabel(nextCard.due_date).split(' ')[0]} paid ·{' '}
            {inr(nextCard.amount_due - nextCard.paid_amount)}
          </Button>
        ) : (
          <Button className="flex-1" disabled>
            {loan.settled_on ? 'Settled' : 'All paid'}
          </Button>
        )}
      </BottomBar>

      <MarkPaidSheet
        card={marking}
        who={borrower?.full_name ?? ''}
        loan={loan}
        onClose={() => setMarking(null)}
      />
      <PaidSheet card={paidOpen} onClose={() => setPaidOpen(null)} />

      <Sheet open={menu} onClose={() => setMenu(false)} title={`Loan ${loanLabel(loan.loan_no)}`}>
        <div className="space-y-2.5">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => navigate(`/loans/${loan.id}/edit`)}
          >
            Edit loan
          </Button>
          {loan.settled_on ? (
            <Button variant="secondary" className="w-full" onClick={() => void reopen()}>
              Reopen
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setMenu(false)
                setSettling(true)
              }}
            >
              Settle / close early
            </Button>
          )}
          <Button
            variant="danger"
            className="w-full"
            onClick={() => void remove()}
            disabled={anyPaid}
          >
            Delete loan
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={settling}
        onClose={() => setSettling(false)}
        title="Settle loan"
        subtitle={`Closes the loan with ${inr(s.remaining)} still unpaid on the cards.`}
      >
        <div className="space-y-3.5">
          <Field label="Settled on">
            <Input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} />
          </Field>
          <Field label="Note">
            <Textarea value={settleNote} onChange={(e) => setSettleNote(e.target.value)} />
          </Field>
          <Button className="w-full" onClick={() => void settle()}>
            Settle
          </Button>
        </div>
      </Sheet>
    </>
  )
}
