import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { db, wipeLocal } from './db'
import { resetKeyCache } from './crypto'

/** undefined while loading, null when signed out. */
/** `VITE_DEV_BYPASS_AUTH=1` in .env.local renders the app with a fake session (dev builds only). */
export const DEV_BYPASS = import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === '1'
const fakeSession = { user: { id: 'dev', email: 'dev@local' } } as unknown as Session

export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(
    DEV_BYPASS ? fakeSession : undefined,
  )
  useEffect(() => {
    if (DEV_BYPASS) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

/** Signs out and forgets everything on this device. Refuses while changes are still queued. */
export async function signOutAndWipe(): Promise<void> {
  const pending = await db.outbox.count()
  if (pending > 0)
    throw new Error(
      `${pending} change(s) are not synced yet. Connect to the internet and sync first.`,
    )
  await supabase.auth.signOut()
  await wipeLocal()
  resetKeyCache()
}
