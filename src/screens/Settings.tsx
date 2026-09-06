import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { signOutAndWipe } from '../lib/auth'
import { cardStatus } from '../lib/cards'
import { errorMessage, loanLabel, todayISO } from '../lib/format'
import { sync, useSyncState } from '../lib/sync'
import { supabase } from '../lib/supabase'
import { fromE164 } from '../lib/validators'
import { ID_LABELS } from '../lib/types'
import {
  Button,
  Card,
  Eyebrow,
  Field,
  Input,
  Notice,
  Page,
  Rule,
  Sheet,
  TopBar,
} from '../components/ui'

const csv = (rows: (string | number | null | undefined)[][]) =>
  rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')

function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export function Settings() {
  const [email, setEmail] = useState<string>('')
  const [admins, setAdmins] = useState<{ user_id: string; name: string | null }[] | null>(null)
  const [newAdmin, setNewAdmin] = useState('')
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const syncState = useSyncState()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''))
    void supabase
      .from('admins')
      .select('user_id,name')
      .then(({ data }) => setAdmins(data ?? []))
  }, [])

  const addAdmin = async () => {
    setMsg(null)
    const { data, error } = await supabase.rpc('add_admin', { p_email: newAdmin.trim() })
    if (error) return setMsg({ tone: 'error', text: error.message })
    if (!data)
      return setMsg({
        tone: 'error',
        text: 'No user with that email. Create it in Supabase → Authentication → Users first.',
      })
    setMsg({ tone: 'success', text: `${newAdmin} is now an admin.` })
    setNewAdmin('')
    const { data: list } = await supabase.from('admins').select('user_id,name')
    setAdmins(list ?? [])
  }

  const exportLedger = async () => {
    const today = todayISO()
    const [people, loans, cards] = await Promise.all([
      db.people.toArray(),
      db.loans.toArray(),
      db.installments.toArray(),
    ])
    const name = new Map(people.map((p) => [p.id, p.full_name]))
    const phone = new Map(people.map((p) => [p.id, fromE164(p.phone)]))
    const loanMap = new Map(loans.filter((l) => !l.deleted_at).map((l) => [l.id, l]))
    const rows = cards
      .filter((c) => loanMap.has(c.loan_id))
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .map((c) => {
        const l = loanMap.get(c.loan_id)!
        return [
          loanLabel(l.loan_no),
          name.get(l.borrower_id),
          phone.get(l.borrower_id),
          c.no,
          c.due_date,
          c.amount_due,
          c.paid_amount,
          c.paid_on,
          c.paid_mode,
          cardStatus(c, today),
          c.note,
        ]
      })
    download(
      `ledger-${today}.csv`,
      csv([
        [
          'Loan no',
          'Borrower',
          'Mobile',
          'Card',
          'Due date',
          'Amount due',
          'Paid',
          'Paid on',
          'Mode',
          'Status',
          'Note',
        ],
        ...rows,
      ]),
    )
  }

  const exportPeople = async () => {
    const [people, proofs] = await Promise.all([db.people.toArray(), db.id_proofs.toArray()])
    const ids = new Map<string, string[]>()
    for (const p of proofs) {
      if (p.deleted_at) continue
      ids.set(p.person_id, [
        ...(ids.get(p.person_id) ?? []),
        `${ID_LABELS[p.id_type]} •••• ${p.id_last4 ?? ''}`,
      ])
    }
    download(
      `people-${todayISO()}.csv`,
      csv([
        ['Name', 'Mobile', 'ID proofs', 'Address', 'Occupation', 'Notes'],
        ...people
          .filter((p) => !p.deleted_at)
          .map((p) => [
            p.full_name,
            fromE164(p.phone),
            (ids.get(p.id) ?? []).join('; '),
            p.address,
            p.occupation,
            p.notes,
          ]),
      ]),
    )
  }

  // One last try to push queued changes, capped so a stuck upload cannot block signing out.
  const askLogout = async () => {
    setMsg(null)
    if (pending > 0 && navigator.onLine) {
      setBusy(true)
      await Promise.race([sync(), new Promise((r) => setTimeout(r, 8000))])
      setBusy(false)
    }
    setConfirmOpen(true)
  }

  const logout = async () => {
    setBusy(true)
    try {
      await signOutAndWipe()
      location.assign(`${import.meta.env.BASE_URL}login`)
    } catch (e) {
      setBusy(false)
      setConfirmOpen(false)
      setMsg({ tone: 'error', text: errorMessage(e) })
    }
  }

  return (
    <>
      <TopBar title="Settings" back="/" />
      <Page className="space-y-6">
        <section>
          <Eyebrow className="mb-2">Signed in</Eyebrow>
          <Card className="px-4 py-3 text-[15px]">{email || '…'}</Card>
        </section>

        <section>
          <Eyebrow className="mb-2">Admins</Eyebrow>
          <Card className="overflow-hidden">
            {admins === null ? (
              <p className="px-4 py-3 text-sm text-ink-3">Needs internet to load.</p>
            ) : (
              admins.map((a) => (
                <div key={a.user_id}>
                  <p className="px-4 py-3 text-[15px]">{a.name ?? a.user_id}</p>
                  <Rule className="mx-4" />
                </div>
              ))
            )}
            <div className="p-4">
              <Field
                label="Add admin by email"
                hint="Create the user in Supabase → Authentication → Users first."
              >
                <div className="flex gap-2.5">
                  <Input
                    type="email"
                    className="flex-1"
                    value={newAdmin}
                    onChange={(e) => setNewAdmin(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    className="h-12 rounded-xl"
                    onClick={() => void addAdmin()}
                    disabled={!newAdmin.includes('@')}
                  >
                    Add
                  </Button>
                </div>
              </Field>
            </div>
          </Card>
        </section>

        <section className="space-y-2.5">
          <Eyebrow>Export</Eyebrow>
          <Button variant="secondary" className="w-full" onClick={() => void exportLedger()}>
            Ledger, all monthly cards · CSV
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => void exportPeople()}>
            People · CSV
          </Button>
        </section>

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <section className="space-y-2">
          <Button
            variant="danger"
            className="w-full"
            onClick={() => void askLogout()}
            disabled={busy}
          >
            {busy
              ? 'Syncing…'
              : `Sign out${pending > 0 ? ` · ${pending} change(s) waiting to sync` : ''}`}
          </Button>
          <p className="text-center text-xs text-ink-4">DevKripa v{__APP_VERSION__}</p>
        </section>
      </Page>

      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Sign out?"
        subtitle={
          pending > 0
            ? `${pending} change(s) have not reached the server yet. Signing out deletes them from this phone.`
            : 'Everything on this phone is removed. It stays on the server.'
        }
      >
        <div className="space-y-3.5">
          {pending > 0 && syncState.error && <Notice tone="error">{syncState.error}</Notice>}
          <div className="flex gap-2.5">
            {pending > 0 ? (
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => void logout()}
                disabled={busy}
              >
                Sign out anyway
              </Button>
            ) : (
              <Button className="flex-1" onClick={() => void logout()} disabled={busy}>
                Sign out
              </Button>
            )}
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  )
}
