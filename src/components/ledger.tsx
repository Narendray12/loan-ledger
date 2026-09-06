import { cardStatus, type CardStatus } from '../lib/cards'
import { daysBetween, fmtDayMonth, inr, monthYear } from '../lib/format'
import type { Installment } from '../lib/types'
import { cx } from './ui'

// The two ledger-specific pieces: the twelve-cell month strip and the installment tile.

const CELL: Record<CardStatus, string> = {
  paid: 'bg-paid',
  partial: 'border-[1.5px] border-ink bg-white',
  overdue: 'bg-late',
  due: 'border-[1.5px] border-ink bg-white',
  upcoming: 'bg-rule',
}

export function MonthStrip({
  cards,
  today,
  size = 'sm',
}: {
  cards: Installment[]
  today: string
  size?: 'sm' | 'lg'
}) {
  const sorted = [...cards].sort((a, b) => a.no - b.no)
  const max = size === 'lg' ? 24 : 13
  return (
    <div className={cx('flex', size === 'lg' ? 'gap-1' : 'gap-[3px]')} aria-hidden="true">
      {sorted.map((c) => (
        <span
          key={c.id}
          className={cx(
            'block rounded-[2px]',
            size === 'lg' ? 'h-2' : 'h-1.5',
            CELL[cardStatus(c, today)],
          )}
          style={{ flex: '1 1 0', maxWidth: max }}
        />
      ))}
    </div>
  )
}

/** "Apr ’26" on the first tile and whenever the year changes, otherwise just the month. */
export function tileLabel(card: Installment, prev?: Installment): string {
  const label = monthYear(card.due_date)
  if (!prev || prev.due_date.slice(0, 4) !== card.due_date.slice(0, 4)) return label
  return label.split(' ')[0]!
}

export function InstallmentTile({
  card,
  prev,
  today,
  onClick,
}: {
  card: Installment
  prev?: Installment
  today: string
  onClick: () => void
}) {
  const st = cardStatus(card, today)
  const box = {
    paid: 'border-paid-line bg-paid-bg',
    overdue: 'border-late-line bg-late-bg',
    due: 'border-2 border-ink bg-white',
    partial: 'border-2 border-ink bg-white',
    upcoming: 'border-rule bg-white opacity-60',
  }[st]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex min-h-24 flex-col justify-between gap-2 rounded-[14px] border p-3 text-left active:opacity-70',
        box,
      )}
    >
      <span className="text-xs font-semibold text-ink-2">{tileLabel(card, prev)}</span>
      <span className="num text-lg leading-none font-bold">{inr(card.amount_due)}</span>
      {st === 'paid' ? (
        <span className="self-end text-paid">
          <span className="stamp">Paid{card.paid_on ? ` · ${fmtDayMonth(card.paid_on)}` : ''}</span>
        </span>
      ) : st === 'overdue' ? (
        <span className="self-end text-late">
          <span className="stamp">Late · {daysBetween(card.due_date, today)} days</span>
        </span>
      ) : st === 'partial' ? (
        <span className="text-xs font-medium text-ink-2">
          {inr(card.paid_amount)} paid · {inr(card.amount_due - card.paid_amount)} left
        </span>
      ) : (
        <span className="text-xs font-medium text-ink-2">Due {fmtDayMonth(card.due_date)}</span>
      )}
    </button>
  )
}
