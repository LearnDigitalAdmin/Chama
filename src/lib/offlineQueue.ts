/**
 * Offline queue for callable Cloud Functions.
 *
 * Direct Firestore writes (loan application/approval, loan products,
 * minutes) already work offline for free via the persistent local cache
 * configured in src/lib/firebase.ts — the Firestore SDK queues and syncs
 * them itself. Callables are different: they're a plain HTTPS request with
 * no built-in offline queue, so without this module every money-critical
 * action (recording a cash payment, disbursing a loan, running an MGR
 * draw...) would just throw the moment a treasurer's phone loses signal
 * mid-meeting — exactly the scenario MyChama exists to survive.
 *
 * Design:
 *  - Every queued call gets a client-generated `clientRequestId`, sent to
 *    the server as part of the payload. The matching Python callables
 *    check this via functions/shared/idempotency.py BEFORE doing any real
 *    work, so a call that actually succeeded server-side but whose
 *    response never reached this device (e.g. connectivity dropped a
 *    second after the request left) is safe to retry: the server returns
 *    the original result instead of applying the action twice.
 *  - `callQueued` tries the real call immediately. If it fails for a
 *    NETWORK reason (offline, unreachable, deadline-exceeded), the call is
 *    persisted to IndexedDB and retried automatically on reconnect. If it
 *    fails for a BUSINESS reason (permission-denied, failed-precondition,
 *    invalid-argument, etc.), it is surfaced to the caller immediately —
 *    retrying a rejected action forever would be wrong, not resilient.
 *  - `startAutoSync()` (called once, in main.tsx) flushes the queue on
 *    the browser's 'online' event and on a slow interval as a fallback
 *    for flaky-but-technically-online connections, then runs
 *    `cleanupStaleEntries()` after every flush.
 *  - Cleanup: entries that fail for a business reason are kept for
 *    inspection (shown as "needs attention" in the sync pill — see
 *    src/app/SyncPill.tsx) but auto-pruned after 7 days, matching the
 *    server-side idempotency key TTL, so the two never disagree about
 *    whether a very old queued action might still land.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const DB_NAME = 'mychama-offline-queue';
const STORE = 'callables';
const DB_VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // must match functions/shared/idempotency.py::IDEMPOTENCY_TTL_MS

export interface QueuedCall {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  status: 'pending' | 'failed';
  lastError?: string;
  /** A short, human label for the sync pill / needs-attention list, e.g. "Record KES 500 cash payment". */
  label: string;
}

type Listener = (calls: QueuedCall[]) => void;
const listeners = new Set<Listener>();

function notify(calls: QueuedCall[]) {
  listeners.forEach((l) => l(calls));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    Promise.resolve(fn(store)).then(resolve, reject);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAll(): Promise<QueuedCall[]> {
  return withStore('readonly', (store) => {
    return new Promise<QueuedCall[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as QueuedCall[]);
      req.onerror = () => reject(req.error);
    });
  });
}

async function put(call: QueuedCall): Promise<void> {
  await withStore('readwrite', (store) => store.put(call));
  notify(await getAll());
}

async function remove(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
  notify(await getAll());
}

function isNetworkError(err: unknown): boolean {
  const code = (err as { code?: string })?.code || '';
  return (
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('internal') ||
    !navigator.onLine
  );
}

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Call a Cloud Function callable with offline resilience.
 *
 * Returns `{ ok: true, result: R }` if it ran (immediately, or you're
 * seeing the result of an immediate successful call) or
 * `{ ok: false, queued: true }` if it's been queued for later — the caller
 * should show a "queued — will sync" state rather than treating this as a
 * failure. Throws only for genuine business-logic rejections.
 */
export async function callQueued<Req extends Record<string, unknown>, Res>(
  name: string,
  payload: Req,
  label: string
): Promise<{ ok: true; result: Res } | { ok: false; queued: true }> {
  const clientRequestId = uuid();
  const fullPayload = { ...payload, clientRequestId };

  if (navigator.onLine) {
    try {
      const fn = httpsCallable<typeof fullPayload, Res>(functions, name);
      const res = await fn(fullPayload);
      return { ok: true, result: res.data };
    } catch (err) {
      if (!isNetworkError(err)) throw err; // business rejection — surface immediately
      // fall through to queue below
    }
  }

  const call: QueuedCall = {
    id: clientRequestId,
    name,
    payload: fullPayload,
    createdAt: Date.now(),
    attempts: 0,
    status: 'pending',
    label,
  };
  await put(call);
  return { ok: false, queued: true };
}

let syncing = false;

/** Attempts every pending queued call, in the order they were queued. */
export async function flushQueue(): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const calls = (await getAll()).filter((c) => c.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
    for (const call of calls) {
      try {
        const fn = httpsCallable(functions, call.name);
        await fn(call.payload);
        await remove(call.id);
      } catch (err) {
        if (isNetworkError(err)) {
          // Still offline / flaky — leave it queued, stop this pass rather
          // than burning through retries on every remaining item.
          break;
        }
        // Business rejection on replay (e.g. the loan was rejected by
        // someone else in the meantime) — don't retry forever, surface it.
        await put({
          ...call,
          status: 'failed',
          attempts: call.attempts + 1,
          lastError: (err as { message?: string })?.message || 'This action could not be completed.',
        });
      }
    }
  } finally {
    syncing = false;
    await cleanupStaleEntries();
  }
}

/** Prunes failed entries older than the server's idempotency-key TTL — past
 * that point a retry would no longer be recognised as the same action
 * anyway, so keeping them around just clutters the "needs attention" list. */
export async function cleanupStaleEntries(): Promise<void> {
  const calls = await getAll();
  const cutoff = Date.now() - MAX_AGE_MS;
  const stale = calls.filter((c) => c.status === 'failed' && c.createdAt < cutoff);
  for (const c of stale) await remove(c.id);
}

export async function retryFailed(id: string): Promise<void> {
  const calls = await getAll();
  const call = calls.find((c) => c.id === id);
  if (!call) return;
  await put({ ...call, status: 'pending' });
  void flushQueue();
}

export async function discardFailed(id: string): Promise<void> {
  await remove(id);
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  getAll().then(listener);
  return () => listeners.delete(listener);
}

let started = false;

/** Call once at app startup (see src/main.tsx). */
export function startAutoSync(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => void flushQueue());
  // Fallback poll for the "technically online but flaky" case, where the
  // 'online' event never fires because the browser never fully dropped.
  setInterval(() => void flushQueue(), 30_000);
  void flushQueue();
}
