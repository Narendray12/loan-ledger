import { useEffect, useState } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router'
import { DEV_BYPASS, signOutAndWipe, useSession } from './lib/auth'
import { startSyncTriggers } from './lib/sync'
import { supabase, supabaseConfigured } from './lib/supabase'
import { Button, Notice } from './components/ui'
import { Login, SetPassword } from './screens/Login'
import { People } from './screens/People'
import { NewApplication } from './screens/NewApplication'
import { PersonDetail } from './screens/PersonDetail'
import { PersonEdit } from './screens/PersonEdit'
import { LoanDetail } from './screens/LoanDetail'
import { LoanEdit } from './screens/LoanEdit'
import { Settings } from './screens/Settings'

function Shell() {
  const session = useSession()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    if (!session) return
    if (DEV_BYPASS || !navigator.onLine) return setIsAdmin(true) // offline: trust the cached session, RLS still guards the server
    void supabase
      .rpc('is_admin')
      .then(({ data, error }) => setIsAdmin(error ? true : Boolean(data)))
  }, [session])

  useEffect(() => (session && !DEV_BYPASS ? startSyncTriggers() : undefined), [session])

  if (session === undefined) return null
  if (!session) return <Navigate to="/login" replace />
  if (isAdmin === false) {
    return (
      <main className="mx-auto max-w-sm space-y-4 p-6 pt-16">
        <Notice tone="error">
          This account ({session.user.email}) is not an admin. Ask an existing admin to add you in
          Settings.
        </Notice>
        <Button className="w-full" onClick={() => void signOutAndWipe()}>
          Sign out
        </Button>
      </main>
    )
  }
  return <Outlet />
}

const router = createBrowserRouter(
  [
    { path: '/login', element: <Login /> },
    {
      element: <Shell />,
      children: [
        { path: '/', element: <People /> },
        { path: '/new/:step?', element: <NewApplication /> },
        { path: '/people/:id', element: <PersonDetail /> },
        { path: '/people/:id/edit', element: <PersonEdit /> },
        { path: '/loans/:id', element: <LoanDetail /> },
        { path: '/loans/:id/edit', element: <LoanEdit /> },
        { path: '/settings', element: <Settings /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  // Served from a sub-path on GitHub Pages; BASE_URL is '/' in dev.
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
)

export function App() {
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(
      (event) => event === 'PASSWORD_RECOVERY' && setRecovery(true),
    )
    return () => data.subscription.unsubscribe()
  }, [])

  if (!supabaseConfigured) {
    return (
      <main className="p-6">
        <Notice tone="error">
          Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see .env.example), then rebuild.
        </Notice>
      </main>
    )
  }
  if (recovery) return <SetPassword onDone={() => setRecovery(false)} />
  return <RouterProvider router={router} />
}
