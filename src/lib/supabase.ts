import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)
export const LENDER = (import.meta.env.VITE_LENDER_NAME as string | undefined) || 'Loan Ledger'

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
