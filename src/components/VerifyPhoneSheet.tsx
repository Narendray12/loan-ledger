import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { enqueue } from '../lib/sync'
import { nowISO } from '../lib/format'
import { fmtPhone, toE164 } from '../lib/validators'
import { IconPhone, IconShield } from './icons'
import { Button, Notice, Sheet } from './ui'

/**
 * Verification without SMS: the admin calls the number while the borrower is present, sees
 * their phone ring, and marks it verified. Recorded locally and queued for the server.
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
  const [called, setCalled] = useState(false)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const phone = toE164(phone10)

  useEffect(() => {
    if (!open) {
      setCalled(false)
      setDone(false)
    }
  }, [open])

  const mark = async () => {
    setBusy(true)
    try {
      const now = nowISO()
      const row = {
        phone,
        verified_at: now,
        person_id: personId ?? null,
        proof: 'call',
        updated_at: now,
      }
      await db.phone_verifications.put(row)
      await enqueue('upsert_phone_verification', phone, row)
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Verify mobile number"
      subtitle="Call the number while the borrower is with you and watch their phone ring."
    >
      {done ? (
        <div className="space-y-3">
          <Notice tone="success">Number verified.</Notice>
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <a
            href={`tel:${phone}`}
            onClick={() => setCalled(true)}
            className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-rule-2 bg-white text-base font-semibold text-ink"
          >
            <IconPhone size={20} /> Call {fmtPhone(phone)}
          </a>
          <Button className="w-full" onClick={() => void mark()} disabled={!called || busy}>
            <IconShield size={20} /> It rang, mark as verified
          </Button>
          {!called && <p className="text-center text-xs text-ink-3">Tap Call first.</p>}
        </div>
      )}
    </Sheet>
  )
}
