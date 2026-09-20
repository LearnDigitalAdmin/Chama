# MyChama — Offline Support Design

MyChama is meant to work in meetings where there's no signal — that's a
first-class requirement, not a nice-to-have, and it shapes several
architecture decisions elsewhere in this codebase. This document explains
what's covered, what isn't, and why.

## The two kinds of writes, and why they're handled differently

### 1. Direct Firestore writes — offline for free

Loan application, loan approval, loan products, and minutes are direct
Firestore writes (see `docs/API_CONTRACT.md`'s Phase 2 correction note —
`firestore.rules` was already designed this way). `src/lib/firebase.ts`
initialises Firestore with `persistentLocalCache` +
`persistentMultipleTabManager`:

```ts
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
```

This is the Firestore JS SDK's own offline support — reads come from an
IndexedDB-backed local cache instantly, writes queue locally and replay
automatically the moment the device reconnects, and `onSnapshot` listeners
keep working against the cache the whole time. None of this required
custom code; it's a configuration choice, and it's why loan
application/approval, editing loan products, and writing minutes all
already work with no signal.

### 2. Callable Cloud Functions — offline via a custom queue

Everything money-critical (`recordCashContribution`, `disburseLoanCash`,
`recordCashLoanRepayment`, the five MGR callables, `addAdmin`/`addMember`)
is a callable, because the spill-forward and payout math has to run
server-side (see each module's docstring in `functions/mychama/` for why).
Callables are a plain HTTPS request — no built-in offline queue — so
`src/lib/offlineQueue.ts` adds one:

- Every queued call gets a client-generated `clientRequestId`.
- The matching Python callable checks it via
  `functions/shared/idempotency.py::already_applied` **before any other
  read or write**. If the same `clientRequestId` already produced a
  result (a replay — connectivity dropped after the server actually
  applied the action but before the response reached the device), the
  server returns the **original** result instead of re-running the money
  logic. This is what makes retrying safe: without it, a treasurer who
  recorded a cash payment right as the signal dropped could see it
  applied twice on reconnect.
- `callQueued` tries the real call immediately. A **network** failure
  (offline, unreachable, deadline-exceeded) queues the action to
  IndexedDB and returns `{ ok: false, queued: true }`. A **business**
  rejection (permission-denied, failed-precondition, insufficient SMS
  credits, etc.) is thrown immediately — queuing something that's already
  been refused would be pointless and confusing.
- `startAutoSync()` (called once, in `main.tsx`) flushes the queue on the
  browser's `online` event and a 30-second fallback poll (for the
  "technically online but flaky" case where `online` never fires), then
  prunes queue entries that failed for a business reason and are older
  than 7 days — matching `IDEMPOTENCY_TTL_MS` on the server side, so the
  two never disagree about whether an old queued action could still land.

### Which callables are NOT queueable, and why

`src/lib/callables.ts` splits every callable into `callable()`
(queueable) or `liveCallable()` (not). The not-queueable ones —
`createChama`, `claimInvite`, `completeProfile`, `initiatePayment`,
`purchaseSmsCredits`, `setupSettlementAccount`, `upgradePlan`,
`generateStatement` — all share one property: the person is waiting for
something to happen *right now* (a navigation, a live Paystack STK push,
a generated document URL). Silently queuing "create your chama" while
offline and having it appear minutes later, with no way for the person to
know it's pending, would be worse than a clear "you need a connection for
this" message. `liveCallable()` gives exactly that message
(`OfflineUnavailableError`) instead of queuing.

## What the UI shows

`src/app/SyncPill.tsx` — a small pill in the sidebar (desktop) or topbar
(mobile) reading "Synced" / "Offline" / "Syncing…" / "Needs attention (n)",
matching the demo's own `syncPill` concept. Clicking it while there's
anything pending or failed opens a short list; failed items show the
server's rejection reason with Retry / Discard actions rather than
looping silently forever. The same file's `OfflineBanner` mirrors the
demo's `#offlineBanner` — a thin strip under the top bar, shown only while
`navigator.onLine` is false.

## What this does NOT cover, and why that's a reasonable line

- **Reading data offline the app has never fetched before.** Firestore's
  persistent cache only has what's been synced at least once. A brand-new
  device that's never been online has nothing to show. This is inherent
  to any offline-first design and isn't solvable without pre-seeding data
  the person hasn't asked for yet.
- **Conflict resolution beyond last-write-wins.** Firestore's offline
  writes are last-write-wins at the field level. For the direct-write
  collections (loan application/approval, minutes), that's fine — two
  people are never racing to write the *same* field. For anything with
  real risk of a genuine conflict (two officials approving contradictory
  changes), routing it through a callable (as this codebase already does
  for every money-touching action) sidesteps the problem entirely,
  because the server serialises those through Firestore transactions.
- **Multi-day offline stretches.** The idempotency-key TTL and queue
  cleanup are both tuned to 7 days. A device offline longer than that
  should reconcile manually rather than trust an ancient queued action —
  flagged here rather than silently handled, since "how stale is too
  stale" is a product decision, not just an engineering one.
