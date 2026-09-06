import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { discardFailedChange, sync, useSyncState } from '../lib/sync'
import { IconCloud, IconCloudOff } from './icons'
import { Button, cx, Sheet, Spinner } from './ui'

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** The small pill in the header: Synced · 3 waiting · Offline · Sync failed. Tap for details. */
export function SyncStatus() {
  const state = useSyncState()
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const head = useLiveQuery(() => db.outbox.orderBy('seq').first(), [state.error, pending])
  const online = useOnline()
  const [open, setOpen] = useState(false)

  const label = !online
    ? pending
      ? `Offline · ${pending} waiting`
      : 'Offline'
    : state.running
      ? 'Syncing'
      : state.error
        ? 'Sync failed'
        : pending
          ? `${pending} waiting`
          : 'Synced'
  const tone = state.error && online ? 'bg-late-bg text-late' : 'bg-tint text-ink-2'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          'inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap',
          tone,
        )}
      >
        {state.running ? (
          <Spinner />
        ) : online ? (
          <IconCloud size={14} />
        ) : (
          <IconCloudOff size={14} />
        )}
        {label}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Sync"
        subtitle={
          online ? 'Online' : 'Offline. Changes stay on this phone and go up when internet is back.'
        }
      >
        <div className="space-y-1.5 text-sm text-ink-2">
          <p>Waiting to send: {pending}</p>
          {state.lastSync && <p>Last sync: {new Date(state.lastSync).toLocaleString('en-IN')}</p>}
          {state.error && (
            <p className="rounded-xl bg-late-bg px-3 py-2 text-late">
              {state.error}
              {head?.last_error && head.last_error !== state.error ? ` (${head.last_error})` : ''}
            </p>
          )}
        </div>
        <div className="mt-5 flex gap-2.5">
          <Button
            className="flex-1"
            onClick={() => void sync()}
            disabled={!online || state.running}
          >
            Sync now
          </Button>
          {state.error && pending > 0 && (
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('Discard the change that keeps failing? It will be lost.'))
                  void discardFailedChange()
              }}
            >
              Discard it
            </Button>
          )}
        </div>
      </Sheet>
    </>
  )
}
