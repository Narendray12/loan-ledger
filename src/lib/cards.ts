import type { Installment, Loan } from './types'

// All dates are 'YYYY-MM-DD' strings; no Date arithmetic across time zones.
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const pad = (n: number) => String(n).padStart(2, '0')

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`
}

type CardInputs = Pick<
  Loan,
  'id' | 'tenure_months' | 'installment_amount' | 'total_repayment' | 'first_due_date'
>

/**
 * One card per month. Every card is the installment written on the paper; the last one
 * absorbs the difference so the cards always add up to the paper's total.
 */
export function generateCards(loan: CardInputs, now: string, ids?: string[]): Installment[] {
  const n = loan.tenure_months
  return Array.from({ length: n }, (_, i) => {
    const last = i === n - 1
    const amount_due = last
      ? Math.max(0, loan.total_repayment - loan.installment_amount * (n - 1))
      : loan.installment_amount
    return {
      id: ids?.[i] ?? crypto.randomUUID(),
      loan_id: loan.id,
      no: i + 1,
      due_date: addMonths(loan.first_due_date, i),
      amount_due,
      paid_amount: 0,
      paid_on: null,
      paid_mode: null,
      note: null,
      marked_by: null,
      updated_at: now,
    }
  })
}

export type CardStatus = 'paid' | 'partial' | 'overdue' | 'due' | 'upcoming'

export function cardStatus(card: Installment, today: string): CardStatus {
  if (card.paid_amount >= card.amount_due) return 'paid'
  if (card.paid_amount > 0) return 'partial'
  if (card.due_date < today) return 'overdue'
  return card.due_date.slice(0, 7) === today.slice(0, 7) ? 'due' : 'upcoming'
}

export interface LoanSummary {
  total: number
  paid: number
  remaining: number
  paidCards: number
  overdueCards: number
  nextDue: Installment | null
  closed: boolean
}

export function loanSummary(loan: Loan, cards: Installment[], today: string): LoanSummary {
  const sorted = [...cards].sort((a, b) => a.no - b.no)
  const paid = sorted.reduce((s, c) => s + c.paid_amount, 0)
  const total = sorted.reduce((s, c) => s + c.amount_due, 0)
  const unpaid = sorted.filter((c) => c.paid_amount < c.amount_due)
  return {
    total,
    paid,
    remaining: Math.max(0, total - paid),
    paidCards: sorted.length - unpaid.length,
    overdueCards: unpaid.filter((c) => c.due_date < today).length,
    nextDue: unpaid[0] ?? null,
    closed: loan.settled_on !== null || (sorted.length > 0 && unpaid.length === 0),
  }
}

export type MonthStatus = 'paid' | 'unpaid' | 'overdue' | 'none'

/** What the home screen shows per person for the current month. */
export function monthStatus(cards: Installment[], today: string): MonthStatus {
  const month = today.slice(0, 7)
  const thisMonth = cards.filter((c) => c.due_date.slice(0, 7) === month)
  const overdue = cards.some((c) => c.due_date < today && c.paid_amount < c.amount_due)
  if (overdue) return 'overdue'
  if (thisMonth.length === 0) return 'none'
  return thisMonth.every((c) => c.paid_amount >= c.amount_due) ? 'paid' : 'unpaid'
}
