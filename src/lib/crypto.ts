import { db, type Sealed } from './db'

// Data at rest on the phone (drafts, queued changes, photos) is AES-GCM encrypted with a
// non-extractable key that lives only in this browser's IndexedDB. It protects against
// device backups and casual inspection, not against code running in this origin.
let keyPromise: Promise<CryptoKey> | undefined

function deviceKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const row = await db.meta.get('device_key')
    if (row) return row.value as CryptoKey
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    await db.meta.put({ key: 'device_key', value: key })
    return key
  })()
  return keyPromise
}

export async function seal(bytes: BufferSource): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), bytes)
  return { iv, data }
}

export async function open(sealed: Sealed): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, await deviceKey(), sealed.data)
}

export const sealJSON = (value: unknown) => seal(new TextEncoder().encode(JSON.stringify(value)))

export async function openJSON<T>(sealed: Sealed): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await open(sealed))) as T
}

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Forget the cached key after wipeLocal() so a new one is generated. */
export function resetKeyCache() {
  keyPromise = undefined
}
