import { describe, expect, it } from 'vitest'
import { addMonths, cardStatus, generateCards, loanSummary, monthStatus } from './cards'
import type { Loan } from './types'

describe('addMonths', () => {
  it('keeps the day when it exists', () => {
    expect(addMonths('2026-01-05', 1)).toBe('2026-02-05')
    expect(addMonths('2026-11-05', 3)).toBe('2027-02-05')
  })
  it('clamps to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
  })
})

const base = {
  id: 'L1',
  tenure_months: 12,
  installment_amount: 5000,
  total_repayment: 60000,
  first_due_date: '2026-10-05',
}

describe('generateCards', () => {
  it('makes one card per month adding up to the total', () => {
    const cards = generateCards(base, '2026-09-05T00:00:00Z')
    expect(cards).toHaveLength(12)
    expect(cards[0]!.due_date).toBe('2026-10-05')
    expect(cards[11]!.due_date).toBe('2027-09-05')
    expect(cards.reduce((s, c) => s + c.amount_due, 0)).toBe(60000)
    expect(cards.map((c) => c.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
  it('lets the last card absorb the difference from the paper total', () => {
    const cards = generateCards({ ...base, total_repayment: 61500 }, 'now')
    expect(cards.slice(0, 11).every((c) => c.amount_due === 5000)).toBe(true)
    expect(cards[11]!.amount_due).toBe(6500)
    expect(cards.reduce((s, c) => s + c.amount_due, 0)).toBe(61500)
  })
  it('never goes negative when the total is below installment × months', () => {
    const cards = generateCards({ ...base, total_repayment: 50000 }, 'now')
    expect(cards[11]!.amount_due).toBe(0)
  })
  it('reuses supplied ids so an edit updates the same rows', () => {
    const ids = ['a', 'b', 'c']
    const cards = generateCards({ ...base, tenure_months: 4 }, 'now', ids)
    expect(cards.map((c) => c.id).slice(0, 3)).toEqual(ids)
    expect(cards[3]!.id).not.toBe('')
  })
})

describe('statuses', () => {
  const cards = generateCards(base, 'now')
  const today = '2026-11-03'
  it('classifies each card', () => {
    expect(cardStatus(cards[0]!, today)).toBe('overdue') // due 5 Oct, unpaid
    expect(cardStatus(cards[1]!, today)).toBe('due') // due 5 Nov, this month
    expect(cardStatus(cards[2]!, today)).toBe('upcoming')
    expect(cardStatus({ ...cards[0]!, paid_amount: 5000 }, today)).toBe('paid')
    expect(cardStatus({ ...cards[0]!, paid_amount: 100 }, today)).toBe('partial')
  })
  it('summarises a loan', () => {
    const loan = { ...base, settled_on: null } as unknown as Loan
    const paid = cards.map((c, i) => (i === 0 ? { ...c, paid_amount: 5000 } : c))
    const s = loanSummary(loan, paid, today)
    expect(s).toMatchObject({
      total: 60000,
      paid: 5000,
      remaining: 55000,
      paidCards: 1,
      overdueCards: 0,
      closed: false,
    })
    expect(s.nextDue?.no).toBe(2)
    expect(
      loanSummary(
        loan,
        cards.map((c) => ({ ...c, paid_amount: 5000 })),
        today,
      ).closed,
    ).toBe(true)
    expect(loanSummary({ ...loan, settled_on: '2026-11-01' }, cards, today).closed).toBe(true)
  })
  it('reports the month status for the home screen', () => {
    expect(monthStatus(cards, today)).toBe('overdue')
    const octPaid = cards.map((c, i) => (i === 0 ? { ...c, paid_amount: 5000 } : c))
    expect(monthStatus(octPaid, today)).toBe('unpaid')
    expect(
      monthStatus(
        octPaid.map((c, i) => (i === 1 ? { ...c, paid_amount: 5000 } : c)),
        today,
      ),
    ).toBe('paid')
    expect(monthStatus(cards, '2026-09-01')).toBe('none')
  })
})
