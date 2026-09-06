import { useEffect, useRef, useState } from 'react'
import type { ConfirmationResult } from 'firebase/auth'
import { db } from '../lib/db'
import { enqueue } from '../lib/sync'
import { nowISO } from '../lib/format'
import { toE164 } from '../lib/validators'
import { LENDER } from '../lib/supabase'
import { Button, Input, Notice, Sheet } from './ui'

type Otp = typeof import('../lib/otp')

/**
 * Sends an OTP to the borrower's phone; the borrower reads it out and the admin types it.
 * Success writes phone_verifications locally and queues it for the server.
 */
export function VerifyPhoneSheet({
  phone10,
  personId,
  open,
  onClose,
}: {
  phone10: string
  personId?: string
  open: boolean
  onClose: () => void
}) {
  const [step, setStep] = useState<'send' | 'code' | 'done'>('send')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const otpRef = useRef<Otp | null>(null)
  const resultRef = useRef<ConfirmationResult | null>(null)
  const captchaRef = useRef<HTMLDivElement>(null)
  const phone = toE164(phone10)

  useEffect(() => {
    if (!open) {
      setStep('send')
      setCode('')
      setError(null)
      resultRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const otp = async () => (otpRef.current ??= await import('../lib/otp'))

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const m = await otp()
      if (!m.otpConfigured) throw new Error('OTP is not set up: add the Firebase keys to .env.')
      if (!navigator.onLine) throw new Error('Sending an OTP needs internet.')
      resultRef.current = await m.sendOtp(phone, captchaRef.current!)
      setStep('code')
      setCooldown(30)
    } catch (e) {
      setError((await otp()).otpErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!resultRef.current) return
    setBusy(true)
    setError(null)
    try {
      const proof = await (await otp()).confirmOtp(resultRef.current, code)
      const now = nowISO()
      const row = { phone, verified_at: now, person_id: personId ?? null, proof, updated_at: now }
      await db.phone_verifications.put(row)
      await enqueue('upsert_phone_verification', phone, row)
      setStep('done')
    } catch (e) {
      setError((await otp()).otpErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Verify mobile number"
      subtitle={`A 6-digit code goes by SMS to +91 ${phone10}. Ask them to read it out.`}
    >
      <div ref={captchaRef} />
      {error && (
        <div className="mb-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {step === 'send' && (
        <Button className="w-full" onClick={() => void send()} disabled={busy}>
          {busy ? 'Sending…' : 'Send code'}
        </Button>
      )}
      {step === 'code' && (
        <div className="space-y-3">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="······"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="num h-16 text-center text-3xl font-bold tracking-[0.4em]"
            autoFocus
          />
          <Button
            className="w-full"
            onClick={() => void verify()}
            disabled={busy || code.length !== 6}
          >
            {busy ? 'Checking…' : 'Verify'}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => void send()}
            disabled={busy || cooldown > 0}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </Button>
        </div>
      )}
      {step === 'done' && (
        <div className="space-y-3">
          <Notice tone="success">Number verified for {LENDER}.</Notice>
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </Sheet>
  )
}
