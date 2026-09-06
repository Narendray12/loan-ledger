export const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN').format(n)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// Dates are ISO strings ('YYYY-MM-DD' or a timestamp). Month names are fixed three-letter
// forms rather than locale output, which spells September as "Sept" on Indian locales.
const local = (iso: string) => new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
const parts = (iso: string) => {
  const d = local(iso)
  return { d: d.getDate(), m: d.getMonth(), y: d.getFullYear() }
}

/** "9 Apr 2026" */
export const fmtDate = (iso: string) => {
  const { d, m, y } = parts(iso)
  return `${d} ${MONTHS[m]} ${y}`
}

/** "9 Apr" */
export const fmtDayMonth = (iso: string) => {
  const { d, m } = parts(iso)
  return `${d} ${MONTHS[m]}`
}

/** "Apr ’26" */
export const monthYear = (iso: string) => {
  const { m, y } = parts(iso)
  return `${MONTHS[m]} ’${String(y).slice(2)}`
}

/** "September 2026" */
export const monthName = (iso: string) => {
  const { m, y } = parts(iso)
  return `${MONTHS_LONG[m]} ${y}`
}

/** "Sep 2026" */
export const monthLabel = (iso: string) => {
  const { m, y } = parts(iso)
  return `${MONTHS[m]} ${y}`
}

/** Whole days from a to b (ISO dates). */
export const daysBetween = (a: string, b: string) =>
  Math.round((local(b).getTime() - local(a).getTime()) / 86_400_000)

/** "L-0042" for numeric loan numbers, otherwise as typed. */
export const loanLabel = (no: string) => (/^\d+$/.test(no) ? 'L-' + no.padStart(4, '0') : no)

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/** Today's date in India as YYYY-MM-DD ('en-CA' formats ISO-style). */
export const todayISO = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

export const nowISO = () => new Date().toISOString()

export const uuid = () => crypto.randomUUID()

export const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)
