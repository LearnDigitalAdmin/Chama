import { useEffect, useState } from 'react';
import { subscribeQueue, retryFailed, discardFailed, type QueuedCall } from '../lib/offlineQueue';

export function useSyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueuedCall[]>([]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const unsub = subscribeQueue(setQueue);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsub();
    };
  }, []);

  return {
    online,
    pending: queue.filter((q) => q.status === 'pending'),
    failed: queue.filter((q) => q.status === 'failed'),
  };
}

/** Small pill for the sidebar/topbar — mirrors the demo's syncPill concept. */
export function SyncPill() {
  const { online, pending, failed } = useSyncStatus();
  const [open, setOpen] = useState(false);

  if (online && pending.length === 0 && failed.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-forest-900/40 px-2 py-1">
        <span className="w-1.5 h-1.5 rounded-full bg-forest-400" /> Synced
      </div>
    );
  }

  const label = !online ? 'Offline' : pending.length ? 'Syncing…' : 'Needs attention';
  const dotClass = !online || pending.length ? 'bg-gold-500 pulse-dot' : 'bg-brick-500';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border border-gold-200 bg-gold-50 text-gold-700"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        {label}
        {pending.length + failed.length > 0 && <span>({pending.length + failed.length})</span>}
      </button>

      {open && (pending.length > 0 || failed.length > 0) && (
        <div className="absolute bottom-full mb-2 left-0 w-72 card shadow-card p-3 z-50 max-h-80 overflow-y-auto">
          {pending.map((q) => (
            <div key={q.id} className="py-2 border-b border-forest-50 last:border-0">
              <p className="text-sm text-ink">{q.label}</p>
              <p className="text-xs text-forest-900/50">Queued — will sync automatically</p>
            </div>
          ))}
          {failed.map((q) => (
            <div key={q.id} className="py-2 border-b border-forest-50 last:border-0">
              <p className="text-sm text-ink">{q.label}</p>
              <p className="text-xs text-brick-500">{q.lastError || 'Could not sync'}</p>
              <div className="flex gap-3 mt-1">
                <button className="text-xs font-semibold text-forest-700" onClick={() => retryFailed(q.id)}>
                  Retry
                </button>
                <button className="text-xs font-semibold text-forest-900/40" onClick={() => discardFailed(q.id)}>
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Full-width banner shown just under the top bar — mirrors the demo's #offlineBanner exactly. */
export function OfflineBanner() {
  const { online } = useSyncStatus();
  if (online) return null;
  return (
    <div className="bg-gold-50 border-b border-gold-200 px-4 py-2 text-xs text-gold-700 font-medium flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-gold-500 pulse-dot" />
      You're offline — changes are queued and will sync automatically.
    </div>
  );
}
