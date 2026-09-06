import type { IdType } from './types'

// Verhoeff checksum (Aadhaar's last digit).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

export function verhoeffValid(digits: string): boolean {
  if (!/^[0-9]+$/.test(digits)) return false
  let c = 0
  const rev = [...digits].reverse()
  for (let i = 0; i < rev.length; i++) {
    c = D[c]![P[i % 8]![Number(rev[i])]!]!
  }
  return c === 0
}

export const PHONE10 = /^[6-9][0-9]{9}$/
const AADHAAR = /^[2-9][0-9]{11}$/
const PAN = /^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/ // 4th letter P = individual
const VOTER = /^[A-Z]{3}[0-9]{7}$/
const DL = /^[A-Z0-9]{10,16}$/ // state formats differ; keep loose

/** Uppercase and strip spaces/hyphens so "1234 5678 9012" and "MH-12 2011..." validate. */
export function normalizeId(type: IdType, raw: string): string {
  const s = raw.replace(/[\s-]/g, '')
  return type === 'aadhaar' ? s : s.toUpperCase()
}

/** Returns an error message, or null when the number is well-formed for its type. */
export function idError(type: IdType, raw: string): string | null {
  const v = normalizeId(type, raw)
  switch (type) {
    case 'aadhaar':
      if (!AADHAAR.test(v)) return 'Aadhaar is 12 digits and cannot start with 0 or 1'
      return verhoeffValid(v) ? null : 'Check the Aadhaar number, the last digit does not match'
    case 'pan':
      return PAN.test(v) ? null : 'PAN looks like ABCPD1234E'
    case 'voter_id':
      return VOTER.test(v) ? null : 'Voter ID looks like ABC1234567'
    case 'driving_licence':
      return DL.test(v) ? null : 'Enter the licence number as printed (10 to 16 characters)'
  }
}

export const toE164 = (phone10: string) => '+91' + phone10.replace(/\D/g, '').slice(-10)
export const fromE164 = (phone: string) => phone.replace(/\D/g, '').slice(-10)

/** "+91 98765 43210" */
export const fmtPhone = (phone: string) => {
  const p = fromE164(phone)
  return `+91 ${p.slice(0, 5)} ${p.slice(5)}`
}

/** "4991 1866 5246" / "ABCPK 1234 F": grouped the way the card prints it. */
export function formatIdNumber(type: IdType, raw: string): string {
  const v = normalizeId(type, raw)
  if (type === 'aadhaar') return v.replace(/(\d{4})(?=\d)/g, '$1 ')
  if (type === 'pan' && v.length === 10) return `${v.slice(0, 5)} ${v.slice(5, 9)} ${v.slice(9)}`
  return v
}

/** What the phone shows when only the last 4 characters are on the device. */
export const maskId = (type: IdType, last4: string | null) =>
  !last4 ? '—' : type === 'aadhaar' ? `•••• •••• ${last4}` : `•••••• ${last4}`
