// Borrower phone verification through Firebase Phone Auth. Free within Firebase's monthly
// quota and Google handles SMS delivery in India. The borrower's number signs in to a
// throwaway in-memory Firebase session that is dropped the moment the code is confirmed;
// nothing about the admin's own login touches Firebase.
import { initializeApp, getApps } from 'firebase/app'
import {
  initializeAuth,
  inMemoryPersistence,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth'

const env = import.meta.env
export const otpConfigured = Boolean(env.VITE_FIREBASE_API_KEY)

let auth: Auth | undefined
let verifier: RecaptchaVerifier | undefined

function getFirebaseAuth(): Auth {
  if (auth) return auth
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    })
  auth = initializeAuth(app, { persistence: inMemoryPersistence })
  auth.languageCode = 'en'
  return auth
}

export async function sendOtp(
  phoneE164: string,
  container: HTMLElement,
): Promise<ConfirmationResult> {
  const a = getFirebaseAuth()
  verifier?.clear()
  verifier = new RecaptchaVerifier(a, container, { size: 'invisible' })
  return signInWithPhoneNumber(a, phoneE164, verifier)
}

/** Resolves with a proof string once the code is right; the throwaway session is signed out. */
export async function confirmOtp(result: ConfirmationResult, code: string): Promise<string> {
  const cred = await result.confirm(code.trim())
  const uid = cred.user.uid
  await signOut(getFirebaseAuth())
  return `firebase:${uid}`
}

export function otpErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'That mobile number is not valid.'
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'Too many attempts. Try again after some time.'
    case 'auth/invalid-verification-code':
      return 'Wrong code. Ask the borrower to read it again.'
    case 'auth/code-expired':
      return 'The code expired. Send a new one.'
    case 'auth/network-request-failed':
      return 'No internet connection.'
    default:
      return (e as Error)?.message ?? 'Could not send the OTP.'
  }
}
