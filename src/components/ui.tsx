import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { Link } from 'react-router'
import { IconBack, IconX } from './icons'

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

export function Button({
  variant = 'primary',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-ink text-paper disabled:bg-ink-4',
    secondary: 'border-[1.5px] border-rule-2 bg-white text-ink disabled:text-ink-4',
    ghost: 'bg-transparent text-ink disabled:text-ink-4',
    danger: 'bg-transparent text-late disabled:text-ink-4',
  }[variant]
  return (
    <button
      type="button"
      className={cx(
        'inline-flex h-13 items-center justify-center gap-2 rounded-[14px] px-5 text-base font-semibold whitespace-nowrap transition active:opacity-80',
        styles,
        className,
      )}
      {...props}
    />
  )
}

export const IconButton = ({ className, ...props }: ComponentProps<'button'>) => (
  <button
    type="button"
    className={cx(
      'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink active:bg-tint',
      className,
    )}
    {...props}
  />
)

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[13px] text-late">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-3">{hint}</span>
      ) : null}
    </label>
  )
}

const control =
  'block w-full min-h-12 rounded-xl border-[1.5px] border-rule-2 bg-white px-3.5 text-base text-ink placeholder:text-ink-4 focus:border-ink focus:outline-none disabled:bg-tint-2 disabled:text-ink-3'

export const Input = ({ className, ...props }: ComponentProps<'input'>) => (
  <input className={cx(control, className)} {...props} />
)

export const Select = ({ className, ...props }: ComponentProps<'select'>) => (
  <select className={cx(control, className)} {...props} />
)

export const Textarea = ({ className, ...props }: ComponentProps<'textarea'>) => (
  <textarea rows={2} className={cx(control, 'py-3', className)} {...props} />
)

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-white px-5 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(18,48,44,0.18)] sm:rounded-3xl">
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-rule-2" />
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

/**
 * Bottom sheet: grabber, title, optional subtitle. Modal by default on a native <dialog>.
 * `modal={false}` renders a plain overlay instead: a modal dialog makes the rest of the page
 * inert, which blocks popups injected outside it (the reCAPTCHA challenge during OTP).
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  modal = true,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  modal?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!modal) return
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open, modal])
  useEffect(() => {
    if (modal || !open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modal, open, onClose])

  if (!modal) {
    if (!open) return null
    return (
      <div
        className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
      >
        <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
        <div className="relative w-full sm:w-[480px]">
          <Panel title={title} subtitle={subtitle}>
            {children}
          </Panel>
        </div>
      </div>
    )
  }
  return (
    <dialog
      ref={ref}
      className="sheet"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <Panel title={title} subtitle={subtitle}>
        {children}
      </Panel>
    </dialog>
  )
}

export const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cx('text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase', className)}>
    {children}
  </p>
)

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('rounded-2xl border border-rule bg-white', className)}>{children}</div>
)

export const Rule = ({ className }: { className?: string }) => (
  <div className={cx('h-px bg-rule', className)} />
)

export function Chip({
  active,
  children,
  onClick,
  className,
}: {
  active?: boolean
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-sm font-medium whitespace-nowrap',
        active ? 'border-ink bg-ink text-paper' : 'border-rule-2 bg-white text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** The small count inside a filter chip. */
export const Count = ({ n }: { n: number }) => (
  <span className="num text-[13px] font-bold opacity-80">{n}</span>
)

export function Badge({
  tone = 'paid',
  children,
  className,
}: {
  tone?: 'paid' | 'late' | 'ink' | 'grey'
  children: ReactNode
  className?: string
}) {
  const tones = {
    paid: 'bg-paid-bg text-paid',
    late: 'bg-late-bg text-late',
    ink: 'bg-ink text-paper',
    grey: 'bg-tint text-ink-2',
  }[tone]
  return (
    <span
      className={cx(
        'inline-flex h-6.5 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap',
        tones,
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Sticky screen header on the paper. `back` may be a route or a handler. */
export function TopBar({
  title,
  subtitle,
  back,
  close,
  right,
}: {
  title?: string
  subtitle?: string
  back?: string | (() => void)
  close?: () => void
  right?: ReactNode
}) {
  const leading =
    typeof back === 'string' ? (
      <Link
        to={back}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink"
        aria-label="Back"
      >
        <IconBack />
      </Link>
    ) : back ? (
      <IconButton onClick={back} aria-label="Back">
        <IconBack />
      </IconButton>
    ) : close ? (
      <IconButton onClick={close} aria-label="Close">
        <IconX />
      </IconButton>
    ) : (
      <span className="w-11" />
    )
  return (
    <header className="sticky top-0 z-20 bg-paper/95 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center justify-between gap-2 px-2 pb-2">
        {leading}
        <div className="min-w-0 flex-1 text-center">
          {title && <h1 className="truncate text-base leading-tight font-semibold">{title}</h1>}
          {subtitle && <p className="truncate text-xs text-ink-3">{subtitle}</p>}
        </div>
        <div className="flex min-w-11 items-center justify-end gap-1">{right}</div>
      </div>
    </header>
  )
}

export const Page = ({ children, className }: { children: ReactNode; className?: string }) => (
  <main className={cx('mx-auto max-w-xl px-4 pt-2 pb-32', className)}>{children}</main>
)

/** Sticky action bar at the thumb, fading out of the paper. */
export const BottomBar = ({ children }: { children: ReactNode }) => (
  <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-paper via-paper/95 to-transparent px-4 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
    <div className="pointer-events-auto mx-auto flex max-w-xl gap-2.5">{children}</div>
  </div>
)

/** Numbered section header, the number matching the paper form. */
export function SectionHeader({
  n,
  title,
  right,
  muted,
}: {
  n: number
  title: string
  right?: ReactNode
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cx(
          'num inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
          muted ? 'bg-tint text-ink' : 'bg-ink text-paper',
        )}
      >
        {n}
      </span>
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      {right && <span className="ml-auto text-xs text-ink-3">{right}</span>}
    </div>
  )
}

/** Label / value row inside a card. */
export const Row = ({
  label,
  value,
  right,
}: {
  label: string
  value: ReactNode
  right?: ReactNode
}) =>
  value === null || value === undefined || value === '' ? null : (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <Eyebrow>{label}</Eyebrow>
        <div className="mt-0.5 text-[15px] whitespace-pre-line">{value}</div>
      </div>
      {right}
    </div>
  )

export const Avatar = ({ name, className }: { name: string; className?: string }) => (
  <span
    className={cx(
      'num inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-[15px] font-bold text-ink',
      className,
    )}
  >
    {name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('')}
  </span>
)

export const Spinner = () => (
  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
)

export const Notice = ({
  tone,
  children,
}: {
  tone: 'error' | 'info' | 'success'
  children: ReactNode
}) => (
  <p
    className={cx(
      'rounded-xl px-3.5 py-2.5 text-sm',
      tone === 'error' && 'bg-late-bg text-late',
      tone === 'info' && 'bg-tint text-ink-2',
      tone === 'success' && 'bg-paid-bg text-paid',
    )}
  >
    {children}
  </p>
)
