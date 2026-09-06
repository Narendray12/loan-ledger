import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useSession } from '../lib/auth'
import { LENDER, supabase } from '../lib/supabase'
import { Button, Field, Input, Notice } from '../components/ui'
import { BrandMark } from '../components/icons'

export function Login() {
  const session = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error)
      setError(
        error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message,
      )
  }

  const forgot = async () => {
    if (!email.trim()) return setError('Enter your email first.')
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: location.origin + import.meta.env.BASE_URL,
    })
    setBusy(false)
    if (error) setError(error.message)
    else setInfo('Check your email for the reset link.')
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col px-7">
      <div className="flex flex-1 flex-col justify-center gap-7">
        <div className="space-y-3.5">
          <BrandMark size={56} />
          <div>
            <h1 className="num text-3xl leading-tight font-bold">{LENDER}</h1>
            <p className="mt-1.5 text-[15px] text-ink-3">Loan ledger</p>
          </div>
        </div>
        <form onSubmit={(e) => void submit(e)} className="space-y-3.5">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          {info && <Notice tone="info">{info}</Notice>}
          <Button type="submit" className="mt-1.5 w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => void forgot()} disabled={busy}>
            Forgot password
          </Button>
        </form>
      </div>
      <p className="pb-7 text-xs text-ink-3">Only people on the admin list can sign in.</p>
    </main>
  )
}

/** Shown after the user opens a password-reset link. */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else onDone()
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-7">
      <h1 className="num mb-5 text-2xl font-bold">Set a new password</h1>
      <form onSubmit={(e) => void submit(e)} className="space-y-3.5">
        <Field label="New password" hint="At least 8 characters">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={busy}>
          Save password
        </Button>
      </form>
    </main>
  )
}
