import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { cardStatus, loanSummary } from '../lib/cards'
import { discardDraftPhotos } from '../lib/docs'
import { fmtDayMonth, inr, loanLabel, monthName, todayISO } from '../lib/format'
import { LENDER } from '../lib/supabase'
import { fromE164 } from '../lib/validators'
import type { Installment, Loan, Person } from '../lib/types'
import { Avatar, Card, Chip, Count, cx, Eyebrow, IconButton, Rule } from '../components/ui'
import { BrandMark, IconPlus, IconSearch, IconSettings, IconX } from '../components/icons'
import { MonthStrip } from '../components/ledger'
import { SyncStatus } from '../components/SyncStatus'

type Filter = 'due' | 'overdue' | 'paid' | 'all'
type RowStatus = 'overdue' | 'due' | 'paid' | 'none'

interface RowData {
  person: Person
  active: Loan[]
  strip: Installment[]
  status: RowStatus
  label: string
  amount: number | null
  sub: string
}

const STATUS_CLASS: Record<RowStatus, string> = {
  overdue: 'text-late',
  due: 'text-ink',
  paid: 'text-paid',
  none: 'text-ink-3',
}

const sum = (cards: Installment[], f: (c: Installment) => number) =>
  cards.reduce((s, c) => s + f(c), 0)

export function People() {
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [filter, setFilter] = useState<Filter>('due')
  const today = todayISO()
  const month = today.slice(0, 7)

  const people = useLiveQuery(() => db.people.filter((p) => !p.deleted_at).toArray(), [])
  const loans = useLiveQuery(() => db.loans.filter((l) => !l.deleted_at).toArray(), [])
  const cards = useLiveQuery(() => db.installments.toArray(), [])
  const drafts = useLiveQuery(() => db.drafts.orderBy('updated_at').reverse().toArray(), [])

  const data = useMemo(() => {
    if (!people || !loans || !cards) return undefined
    const byLoan = new Map<string, Installment[]>()
    for (const c of cards) byLoan.set(c.loan_id, [...(byLoan.get(c.loan_id) ?? []), c])
    const byBorrower = new Map<string, Loan[]>()
    for (const l of loans)
      byBorrower.set(l.borrower_id, [...(byBorrower.get(l.borrower_id) ?? []), l])
    const coOf = new Set(loans.map((l) => l.co_borrower_id))

    const rows: RowData[] = people.map((person) => {
      const mine = byBorrower.get(person.id) ?? []
      const active = mine.filter((l) => !loanSummary(l, byLoan.get(l.id) ?? [], today).closed)
      const activeCards = active.flatMap((l) => byLoan.get(l.id) ?? [])
      const overdue = activeCards.filter((c) => cardStatus(c, today) === 'overdue')
      const thisMonth = activeCards.filter((c) => c.due_date.slice(0, 7) === month)
      const unpaid = thisMonth.filter((c) => c.paid_amount < c.amount_due)
      const first = active[0]
      let status: RowStatus = 'none'
      let label = ''
      let amount: number | null = null
      if (overdue.length) {
        status = 'overdue'
        const oldest = overdue.reduce(
          (a, c) => (c.due_date < a ? c.due_date : a),
          overdue[0]!.due_date,
        )
        label = `Overdue since ${fmtDayMonth(oldest)}`
        amount = sum(overdue, (c) => c.amount_due - c.paid_amount)
      } else if (unpaid.length) {
        status = 'due'
        label = `Due ${fmtDayMonth(unpaid[0]!.due_date)}`
        amount = sum(unpaid, (c) => c.amount_due - c.paid_amount)
      } else if (thisMonth.length) {
        status = 'paid'
        const on = thisMonth
          .map((c) => c.paid_on)
          .filter(Boolean)
          .sort()
          .pop()
        label = `Paid${on ? ` ${fmtDayMonth(on)}` : ''}`
        amount = sum(thisMonth, (c) => c.paid_amount)
      } else {
        const next = activeCards
          .filter((c) => c.paid_amount < c.amount_due)
          .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
        if (next) {
          label = `Next ${fmtDayMonth(next.due_date)}`
          amount = next.amount_due
        } else if (mine.length) label = 'Closed'
        else label = coOf.has(person.id) ? 'Co-borrower' : 'No loan yet'
      }
      const sub = first
        ? `${loanLabel(first.loan_no)} · ${inr(first.installment_amount)}/mo${active.length > 1 ? ` +${active.length - 1}` : ''}`
        : fromE164(person.phone)
      return {
        person,
        active,
        strip: first ? (byLoan.get(first.id) ?? []) : [],
        status,
        label,
        amount,
        sub,
      }
    })

    const monthCards = loans
      .filter((l) => !loanSummary(l, byLoan.get(l.id) ?? [], today).closed)
      .flatMap((l) => byLoan.get(l.id) ?? [])
      .filter((c) => c.due_date.slice(0, 7) === month)
    return {
      rows,
      hero: {
        dueCount: monthCards.length,
        paidCount: monthCards.filter((c) => c.paid_amount >= c.amount_due).length,
        collected: sum(monthCards, (c) => Math.min(c.paid_amount, c.amount_due)),
        total: sum(monthCards, (c) => c.amount_due),
      },
      counts: {
        due: rows.filter((r) => r.status === 'due').length,
        overdue: rows.filter((r) => r.status === 'overdue').length,
        paid: rows.filter((r) => r.status === 'paid').length,
        all: rows.length,
      },
    }
  }, [people, loans, cards, today, month])

  const term = q.trim().toLowerCase()
  const shown = data?.rows
    .filter((r) =>
      term
        ? r.person.full_name.toLowerCase().includes(term) ||
          fromE164(r.person.phone).includes(term) ||
          r.active.some((l) => loanLabel(l.loan_no).toLowerCase().includes(term))
        : true,
    )
    .filter((r) => (term || filter === 'all' ? true : r.status === filter))
    .sort((a, b) => a.person.full_name.localeCompare(b.person.full_name))

  const discardDraft = async (id: string) => {
    if (!confirm('Discard this unfinished application and its photos?')) return
    await discardDraftPhotos(id)
    await db.drafts.delete(id)
  }

  return (
    <>
      <header className="sticky top-0 z-20 bg-paper/95 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 pb-1">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-base font-semibold">{LENDER}</span>
          </div>
          <div className="flex items-center gap-0.5">
            <SyncStatus />
            <IconButton aria-label="Search" onClick={() => setSearching((s) => !s)}>
              <IconSearch />
            </IconButton>
            <Link
              to="/settings"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink"
              aria-label="Settings"
            >
              <IconSettings />
            </Link>
          </div>
        </div>
        {searching && (
          <div className="mx-auto max-w-xl px-4 pb-2">
            <label className="flex min-h-12 items-center gap-2.5 rounded-xl bg-tint-2 px-3.5 text-ink-3">
              <IconSearch size={20} />
              <input
                className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-4 focus:outline-none"
                placeholder="Name, mobile or loan no."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                aria-label="Close search"
                onClick={() => {
                  setQ('')
                  setSearching(false)
                }}
              >
                <IconX size={20} />
              </button>
            </label>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-xl px-4 pt-3 pb-32">
        <section>
          <Eyebrow>
            {monthName(today)} · {data?.hero.dueCount ?? 0} installments due
          </Eyebrow>
          <div className="mt-2 flex items-baseline gap-2.5 border-b-[1.5px] border-ink pb-1.5">
            <span className="num text-[46px] leading-none font-bold">
              {inr(data?.hero.collected ?? 0)}
            </span>
            <span className="text-sm font-medium text-ink-3">
              collected of {inr(data?.hero.total ?? 0)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[13px]">
            <span className="text-ink-3">
              {inr(Math.max(0, (data?.hero.total ?? 0) - (data?.hero.collected ?? 0)))} still to
              collect
            </span>
            <span className="num font-bold text-ink-2">
              {data?.hero.paidCount ?? 0} / {data?.hero.dueCount ?? 0} paid
            </span>
          </div>
        </section>

        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
          <Chip active={filter === 'due'} onClick={() => setFilter('due')}>
            Due <Count n={data?.counts.due ?? 0} />
          </Chip>
          <Chip active={filter === 'overdue'} onClick={() => setFilter('overdue')}>
            <span className="h-2 w-2 rounded-full bg-late" /> Overdue{' '}
            <Count n={data?.counts.overdue ?? 0} />
          </Chip>
          <Chip active={filter === 'paid'} onClick={() => setFilter('paid')}>
            Paid <Count n={data?.counts.paid ?? 0} />
          </Chip>
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
            All <Count n={data?.counts.all ?? 0} />
          </Chip>
        </div>

        {drafts && drafts.length > 0 && (
          <Card className="mb-3 overflow-hidden">
            {drafts.map((d, i) => (
              <div key={d.id}>
                <div className="flex items-center gap-2 pr-2">
                  <Link to={`/new/1?draft=${d.id}`} className="flex-1 px-4 py-3">
                    <Eyebrow>Unfinished application</Eyebrow>
                    <span className="mt-0.5 block text-[15px] font-semibold">{d.title}</span>
                    <span className="block text-xs text-ink-3">
                      {new Date(d.updated_at).toLocaleString('en-IN')}
                    </span>
                  </Link>
                  <IconButton aria-label="Discard draft" onClick={() => void discardDraft(d.id)}>
                    <IconX size={20} />
                  </IconButton>
                </div>
                {i < drafts.length - 1 && <Rule className="mx-4" />}
              </div>
            ))}
          </Card>
        )}

        {!shown ? null : shown.length === 0 ? (
          <p className="py-12 text-center text-[15px] text-ink-3">
            {people?.length
              ? term
                ? 'No one matches.'
                : filter === 'due'
                  ? 'Nothing due this month.'
                  : filter === 'overdue'
                    ? 'Nobody is overdue.'
                    : 'No payments this month yet.'
              : 'No borrowers yet. Tap New application to add the first.'}
          </p>
        ) : (
          <Card className="overflow-hidden rounded-[18px]">
            {shown.map((r, i) => (
              <div key={r.person.id}>
                <Link to={`/people/${r.person.id}`} className="flex items-center gap-3 px-4 py-3.5">
                  <Avatar name={r.person.full_name} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="truncate text-base leading-tight font-semibold">
                      {r.person.full_name}
                    </span>
                    <span className="truncate text-[13px] text-ink-3">{r.sub}</span>
                    {r.strip.length > 0 && <MonthStrip cards={r.strip} today={today} />}
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {r.amount !== null && (
                      <span className="num text-[17px] font-bold">{inr(r.amount)}</span>
                    )}
                    <span className={cx('text-xs font-semibold', STATUS_CLASS[r.status])}>
                      {r.label}
                    </span>
                  </span>
                </Link>
                {i < shown.length - 1 && <Rule className="mx-4" />}
              </div>
            ))}
          </Card>
        )}
      </main>

      <Link
        to="/new/1"
        className="fixed right-4 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-[18px] bg-ink pr-5 pl-4 text-base font-semibold text-paper shadow-[0_8px_24px_rgba(18,48,44,0.28)]"
      >
        <IconPlus size={22} /> New application
      </Link>
    </>
  )
}
