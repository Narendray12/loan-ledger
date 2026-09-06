import { describe, expect, it } from 'vitest'
import { idError, normalizeId, toE164, verhoeffValid } from './validators'

describe('verhoeff', () => {
  it('accepts the textbook vector 236 -> 2363', () => {
    expect(verhoeffValid('2363')).toBe(true)
    expect(verhoeffValid('2364')).toBe(false)
  })
  it('catches single-digit errors and transpositions', () => {
    // 499118665246 is 49911866524 + its Verhoeff check digit 6
    expect(verhoeffValid('499118665246')).toBe(true)
    expect(verhoeffValid('499118665245')).toBe(false) // wrong last digit
    expect(verhoeffValid('499118665146')).toBe(false) // one digit changed
    expect(verhoeffValid('499118656246')).toBe(false) // adjacent digits swapped
  })
})

describe('idError', () => {
  it('aadhaar: 12 digits, not starting with 0/1, valid checksum', () => {
    expect(idError('aadhaar', '4991 1866 5246')).toBeNull()
    expect(idError('aadhaar', '1991 1866 5246')).toMatch(/cannot start/)
    expect(idError('aadhaar', '499118665245')).toMatch(/last digit/)
    expect(idError('aadhaar', '12345')).toMatch(/12 digits/)
  })
  it('pan: individual format with P as 4th letter', () => {
    expect(idError('pan', 'abcpd1234e')).toBeNull()
    expect(idError('pan', 'ABCCD1234E')).not.toBeNull()
    expect(idError('pan', 'ABCPD123E')).not.toBeNull()
  })
  it('voter id and driving licence', () => {
    expect(idError('voter_id', 'ABC1234567')).toBeNull()
    expect(idError('voter_id', 'AB1234567')).not.toBeNull()
    expect(idError('driving_licence', 'MH12 20110012345')).toBeNull()
    expect(idError('driving_licence', 'MH12')).not.toBeNull()
  })
  it('normalises spaces, hyphens and case', () => {
    expect(normalizeId('pan', ' abc-pd 1234e ')).toBe('ABCPD1234E')
    expect(normalizeId('aadhaar', '4991 1866 5246')).toBe('499118665246')
  })
})

describe('phone', () => {
  it('converts to E.164 for India', () => {
    expect(toE164('98765 43210')).toBe('+919876543210')
    expect(toE164('+91 9876543210')).toBe('+919876543210')
  })
})
