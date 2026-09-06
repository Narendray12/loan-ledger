import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { wipeLocal } from './db'
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

/**
 * Signs out and forgets everything on this device. Works offline too: if the server cannot be
 * reached the local session is dropped anyway, so the phone is always left clean.
 */
export async function signOutAndWipe(): Promise<void> {
  const { error } = await supabase.auth
    .signOut({ scope: 'local' })
    .catch((e: unknown) => ({ error: e }))
  if (error) {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-')) localStorage.removeItem(key)
    }
  }
  await wipeLocal()
  resetKeyCache()
}
