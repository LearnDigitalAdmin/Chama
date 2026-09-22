# MyChama — Phase 4 touch-base

Read this before deploying or continuing the build. It says, plainly: what
Phase 4 built, what I found and fixed that had nothing to do with Phase 4,
what's still fake or missing for a *real* production launch, and exactly
what to do about each one. Nothing in the code itself is a placeholder or
a TODO — every screen and every callable does what it claims to do. The
gaps below are things that need a decision, a deploy step, or a second
repo, not a coding shortcut I left behind.

---

## 1. The most important gap — merry-go-round payouts and loan disbursements are cash-only

This is the exact thing you flagged in your original message ("when
distributing funds via Paystack, it will need a payment method, where
recipient money goes"), and it's real:

- `functions/mychama/mgr.py::recordMgrPayoutCash` and
  `functions/mychama/loans.py::disburseLoanCash` are the **only** payout/
  disbursement paths that exist anywhere in this repo. Both record that an
  admin handed someone cash. Neither one moves money.
- Sending money *out* to a member (M-Pesa, Airtel, or bank) needs
  Paystack's **Transfers** API — a recipient (`/transferrecipient`, which
  needs the member's own mobile money number or bank details on file),
  a transfer (`/transfer`), and a webhook branch to confirm it landed.
  None of that exists. `ChamaMember` has no phone-for-receiving-money
  field distinct from their contact phone, and there's no UI anywhere to
  collect or confirm one.
- I checked the demo's own marketing copy for the Billing screen — it
  said "automated Paystack payouts" for the paid plans. That would have
  been a straight-up lie about what this app can actually do, so **I
  corrected `src/lib/constants.ts`'s `PLAN_COPY`** to say payouts are
  "recorded in cash for now" on every tier. Collections (people paying
  *into* the chama) are genuinely automated via Paystack on paid plans —
  it's specifically payouts and disbursements that aren't.

**What it would take to actually build this** (a real Phase 5, not a small
addition):
1. A "how should we pay you?" field per member — mobile money number
   (which may differ from their login/contact phone) or bank
   account+code — collected once, shown back masked, editable via a
   member-initiated flow (the same self-service pattern as this phase's
   "leave chama").
2. `initiateMgrPayout(chamaId, potId, memberId)` / `initiateLoanDisbursement(...)`
   callables that create a Paystack transfer recipient (or reuse the
   member's), start a transfer, and record a pending `payouts`/loan
   disbursement doc — mirroring `initiatePayment`'s pending-then-webhook
   shape, but for money going out instead of in.
3. A new PAY-repo webhook branch for `transfer.success`/`transfer.failed`
   (that repo currently only has payment-*in* handling, per
   `docs/IMPLEMENTATION_PLAN.md`'s Phase 3 notes — MCW-/MCA-/MCS-/MCP- are
   all charges, not transfers).
4. Paystack transfers need a second-factor OTP or a pre-approved
   "disable OTP for transfers" setting on the Paystack account (a
   business decision for whoever owns the Paystack account, not a code
   change) — worth deciding before building step 2.

Until then: MGR payouts and loan disbursements are, correctly, cash-only
everywhere in the UI (`MyMgr.tsx`, `MgrPotDetail.tsx`, `Loans.tsx`,
`MyLoans.tsx`) — I didn't add a "pay out via Paystack" button anywhere,
because there's no backend to call.

---

## 2. What Phase 4 actually built

**Backend** (`functions/mychama/billing.py`, new):
- `upgradePlan` — chair-only. A downgrade (or a move to Free) that would
  put the chama over the target plan's `memberLimit` is blocked; anything
  else with `price > 0` follows the exact pending-record-then-Paystack-STK
  pattern as `purchaseSmsCredits` (reference prefix `MCP-`, collection
  `planBilling`), and — like SMS top-ups — **the actual `chamas.plan`
  update happens in the PAY repo's webhook, not in this function**. A
  downgrade or move to Free applies immediately, no payment needed.
- `generateStatement` — finance admin (any scope) or a member (their own
  only). Renders the `transactions` ledger — the single already-existing
  source of truth for every financial event — to PDF (reportlab) or CSV
  for a date range, member-scoped or whole-chama, uploads it to Cloud
  Storage, and returns a 48-hour signed URL. Enforces
  `exportsAllowed`/`minutesQuota`/`minutesExportsUsedThisMonth`. Also
  handles single-minutes-entry PDF export via a `minutesId` parameter —
  see §3 below, this is a deliberate small addition beyond the original
  contract shape.
- `sweep_plan_expiry` (daily) — downgrades any chama whose paid plan has
  lapsed back to Free, and sends the chair one reminder SMS 3 days before
  expiry if `autoRenew` is on. This is a *reminder*, not a real
  auto-charge — Paystack mobile-money charges need a live STK push with
  PIN entry, so there is no way to silently re-bill an M-Pesa/Airtel
  plan. If you want real silent renewal later, it would need a saved
  card (Paystack supports recurring charges on cards, not on mobile
  money) as an alternative payment method for plan billing specifically.
- `reset_monthly_export_quota` (1st of every month) — **this fixes a real
  pre-existing bug**: nothing was ever resetting
  `minutesExportsUsedThisMonth`. A chama that used its one free export in
  its first month would have stayed locked out of free exports forever.

**Frontend, all wired to live Firestore data, nothing hardcoded**:
- `AdminDashboard.tsx` / `MemberDashboard.tsx` (Home) — see §4 for the
  aggregation approach.
- `Billing.tsx` — plan cards (ported the demo's copy, corrected per §1),
  upgrade/downgrade flow, auto-renew toggle, billing history.
- `Reports.tsx` — unlimited raw CSV dumps (Members/Contributions/Loans/
  Transactions, gated only by `exportsAllowed`) plus the quota-gated
  `generateStatement` form. See §3 for why these are two different
  things.
- `Settings.tsx` (officials) — chama profile edit, admins list, links out
  to the existing Loan Products / Settlement / Members screens rather
  than duplicating them.
- `Messages.tsx` (member) — an inbox read from `smsLog`, filtered to
  messages addressed to that member. Doubles as a fallback: if the actual
  SMS failed to deliver, the member still sees it in-app.
- `Profile.tsx` (member) — identity, membership status, a narrow
  self-service "leave this chama" action, sign out.
- `MyContributions.tsx`, `MyLoans.tsx`, `MyMgr.tsx` — the member-facing
  views the demo always had but Phase 2 never built (Phase 2 built one
  shared admin-style table for each and left every member seeing the same
  admin view). Each includes a "pay now via M-Pesa/Airtel" flow through
  the *existing* `initiatePayment` callable — Phase 3 built that callable
  but nothing in the frontend ever called it for a member-initiated
  payment before now.
- `Minutes.tsx` — added a quota-gated "Export PDF" button per entry.

`Contributions.tsx`, `Loans.tsx`, and `MgrPots.tsx` now branch by role
(`membership.role === 'member'` renders the new member view; anyone else
gets the existing admin view, untouched) rather than being new routes —
this keeps the well-tested admin logic exactly as it was.

---

## 3. Design decisions I made where the spec was ambiguous

**Bulk exports vs. statements are two different things**, on purpose. The
demo's Reports screen dumped whole collections as CSV with no quota. The
Phase 4 spec's `generateStatement` explicitly enforces a monthly quota.
I kept both: `Reports.tsx`'s CSV buttons are unlimited-on-paid-plans raw
dumps (gated only by the `exportsAllowed` boolean, no quota — this is
formatting data the client already has legitimate access to), and
`generateStatement` is the quota-controlled, nicely-formatted PDF/CSV
statement for a member or the whole chama. If you wanted the raw dumps to
also count against the quota, that's a one-line change in `Reports.tsx`
(route them through `generateStatement` too) — I didn't do that because
nothing in the contract said to.

**`generateStatement` reads from `transactions`, not from
contributions/loans/mgrRecords directly.** `transactions` is already the
append-only ledger every financial event writes to. Building a statement
from the source collections instead would mean collection-group queries
across every MGR pot's `records`/`payouts` subcollections, which have no
collection-group index today and would need one. Reading the ledger
avoids that entirely and is, I think, the architecturally correct choice
regardless.

**Minutes PDF export goes through `generateStatement` via a `minutesId`
parameter that isn't in the original contract shape** (`{chamaId,
memberId?, from, to, format}` had no room for "just this one meeting").
I added `minutesId?: string` and made `from`/`to` optional when it's set
— both the Python callable and the `src/lib/callables.ts` TypeScript type
were updated together, so this is a real, working addition, not a
mismatch. If you'd rather keep `generateStatement`'s contract exactly as
written and give minutes its own callable, that's a clean split later;
I chose not to add a whole new callable for one PDF template.

**Dashboard aggregation** — I used small-scope `onSnapshot` listeners
(this period's contributions, active/pending loans, mgr pots, a handful
of recent transactions/messages/minutes) rather than maintained counters
or `getCountFromServer`. Reasoning is in `AdminDashboard.tsx`'s file
header: it matches every other screen in this codebase and gives the
mid-meeting "watch it update" feel that's the whole point of the product.
At chama scale (dozens to low hundreds of docs per collection) this is
cheap. If a chama's transaction history gets into the thousands, the
count-only KPIs (not the activity feed, which should stay a listener) are
the first candidates to switch to `getCountFromServer`.

**Member self-service "leave chama"** is a direct Firestore write (not a
callable), gated by a new, narrow `firestore.rules` clause: a member may
move *themselves* from `active` to `inactive`, and only that direction —
never the reverse, never any other member. Self-reinstatement isn't
allowed because the schema only has three member statuses (no separate
"left voluntarily" vs. "removed for cause"), so the server can't tell
those apart once someone is `inactive` — reactivating needs an admin
either way. I did not build "pause/resume" (the demo had a `paused`
status) for the same reason — it doesn't fit the current 3-status schema
without adding a 4th status and re-touching every place that reads
`status`, which felt like more surface area than this phase should take
on unasked.

---

## 4. Bugs and gaps found that predate Phase 4 (not introduced by it)

- **`chamas.minutesExportsUsedThisMonth` was never reset.** Fixed —
  `reset_monthly_export_quota` now runs on the 1st of every month.
- **`storage.rules` was still the default `firebase init` placeholder** —
  `allow read, write: if true` until an expiry date in October 2026. That
  means, right now, anything uploaded to the `mychama1` bucket is
  world-readable and world-writable. Fixed: replaced with a deny-all —
  Phase 4's own statement/minutes PDFs are delivered via signed URL, which
  bypasses Storage rules entirely by design, so a deny-all is correct and
  loses no functionality.
- **`docs/IMPLEMENTATION_PLAN.md`'s Phase 1 checklist was still 100%
  unchecked**, and a separate root-level copy had Phase 2/3 checked but
  the `docs/` copy didn't — the file was just never kept in sync with the
  actual code across sessions. I verified Phase 1/2/3 against the real
  code (not the old checklist) and corrected it; see the file itself for
  what I could and couldn't verify from a static repo (deployment/live-auth
  testing obviously can't be confirmed from here).
- **Doc duplication.** The repo had `API_CONTRACT.md`,
  `docs/API_CONTRACT.md`, and `docs/API_CONTRACT (2).md` — three copies,
  two different and stale. Same for `IMPLEMENTATION_PLAN.md` and
  `README (2).md`/`README (3).md`. I consolidated: `docs/API_CONTRACT.md`
  and `docs/IMPLEMENTATION_PLAN.md` are now the single current copies
  (matching what `docs/CONVENTIONS.md` already pointed at), the old
  Phase 2/3 delivery READMEs moved to `docs/delivery-history/` instead of
  being deleted outright, and a stray empty `docs/index.ts` is gone.
- **The `settlements` collection has rules but nothing ever writes to
  it.** Paystack subaccounts settle to the linked paybill/till/bank
  automatically on their own schedule (that part genuinely works, it's a
  Paystack platform feature configured when the subaccount is created,
  not something MyChama's code needs to drive) — but there's no record of
  *when* a settlement happened for the Payments screen to show. Left
  as-is; flagging it here rather than building settlement-webhook
  ingestion that Phase 3 didn't scope and Phase 4 wasn't asked to either.
- **The demo's MGR "v3.1" has an arrears ledger and exit-refund/clawback
  system that Phase 2 never ported** — the shared `mgr_engine.py` only
  has the draw algorithm, late-scoring, and pool math. `MyMgr.tsx` (this
  phase) is built against what the backend actually has, not the fuller
  demo model. You said gaps between phases could wait — this is the one
  I ran into and didn't try to silently work around.
- **`smsLog` had no `recipientIds` field**, so there was no reliable way
  to know which members a given SMS campaign was addressed to (only an
  `audience` label like `'overdue'`, which drifts as members' statuses
  change over time). Added `recipientIds: string[]` to both places
  `smsLog` gets written in `sms.py` — this is what `Messages.tsx` filters
  on, and it's a nice side effect that a member now sees a campaign in-app
  even if the SMS itself failed to send.

---

## 5. Things I could verify from inside this repo, and things I couldn't

**Verified, with tools, in this session** (not just "should work"):
- Full TypeScript project build: `npx tsc -b --force` — clean, zero errors.
- Full Vite production build — succeeds (one pre-existing bundle-size
  warning, unrelated to this phase — see §6).
- `npx oxlint` — 0 errors; the 14 warnings that exist are all in
  pre-existing files this phase didn't touch (`ChamaProvider.tsx`,
  `AuthProvider.tsx`, `useMembers.ts`, `NavIcons.tsx`, `SyncPill.tsx`,
  and a couple of `Loans.tsx`/`Contributions.tsx` lines outside what I
  changed). None of the files added this phase produced a warning.
- The entire Python `functions/` package imports cleanly (`import main`
  registers all 33 callables/triggers/schedules, including the 4 new
  ones) under a real `pip install -r requirements.txt`, and `pyflakes`
  found nothing beyond the expected "imported but unused" noise that
  every function in `main.py` already has (that's how Cloud Functions
  registration works — the import *is* the registration).
- `billing.py`'s CSV/PDF/minutes-PDF renderers were actually executed
  against sample data — real `%PDF-1.4` output, real CSV rows, an empty-
  transactions edge case handled without an exception.

**Could not verify from inside this repo** (no deployed project, no
Paystack/HostPinnacle sandbox access, no PAY-repo access):
- Whether the PAY repo's webhook actually has an `MCP-`/
  `mychama_plan_upgrade` branch. `docs/IMPLEMENTATION_PLAN.md`'s Phase 3
  notes claim `MCP-` was already wired into `determineChargeType` ahead
  of this phase being built, in anticipation — I can't confirm that from
  here since PAY is a separate repository. **Before relying on
  `upgradePlan` in production, check the PAY repo's `determineChargeType`
  for a case matching `chargeType: 'mychama_plan_upgrade'`** that credits
  `chamas/{chamaId}.plan = toPlan` and `planExpiry = today + 30 days` on
  `charge.success`, and marks `planBilling/{reference}.status` on both
  `charge.success` and `charge.failed` — mirroring whatever it already
  does for `mychama_sms_topup`.
- Anything that requires a live Firestore project: rules actually
  enforcing what I wrote (I checked every rule against every read/write
  the code performs, but that's not the same as running the emulator or a
  real deploy against it), composite indexes actually building, the
  signed-URL IAM permission (next section), real STK pushes.
- The end-to-end reconciliation against the WhatsApp bot that
  `docs/IMPLEMENTATION_PLAN.md` calls for — needs a live project and a
  live bot session; not something a repo checkout can produce.

---

## 6. Go-live checklist

1. **Grant the Cloud Functions runtime service account
   `roles/iam.serviceAccountTokenCreator` on itself.**
   `generateStatement`'s `blob.generate_signed_url(...)` uses the IAM
   SignBlob API under the hood; the default Cloud Functions 2nd-gen
   service account does not have this permission by default, and without
   it every statement/minutes export will fail with an "internal" error
   at the signing step, not at generation. This is the single most likely
   thing to trip someone up on first deploy.
2. **Deploy rules, indexes, and storage rules together**:
   `firebase deploy --only firestore:rules,firestore:indexes,storage`.
   Composite index builds are asynchronous — wait for them to reach
   *Enabled* in the console (see `INDEXES.md`) before pointing real
   traffic at the project, or the first statement/dashboard query that
   needs the new `transactions: memberId+date` index will fail.
3. **Set a TTL policy on `whatsappAuditLog`** (and consider one for
   `smsLog`/`transactions` once there's a real retention policy) — this
   is a one-time `gcloud firestore fields ttl-policies create` action
   against the live project; it isn't expressible in any file in this
   repo, which is why it was never done.
4. **Verify the PAY repo's `MCP-` webhook branch** — see §5.
5. **Decide on Firebase App Check** for the callable functions — nothing
   in this repo enables it. Not a blocker, but worth a decision before a
   real launch, since callable functions are otherwise reachable by
   anyone who extracts the (intentionally public) Firebase client config.
6. **Bundle size**: `npx vite build` reports one JS chunk at ~846 KB
   (245 KB gzipped) — over the default 500 KB warning threshold. Not new
   to this phase (Firebase's SDK is most of it) and not a functional
   problem, but worth a `React.lazy()` pass per route if initial load
   time matters before launch.
7. Read §1 again before promising anyone "automated payouts."
