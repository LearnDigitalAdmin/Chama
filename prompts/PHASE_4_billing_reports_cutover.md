# MyChama — Phase 4 Prompt: Billing, Reports & Cutover

Paste this into a fresh chat, attach the demo file `MyChama_3_1.html`, and
attach/connect the **Chama** repo. Phases 1–3 must already be merged
(auth, core operations, and Paystack/SMS all working).

---

I'm finishing the live build of MyChama on Firebase project `mychama1`.
Phases 1–3 are done: auth, core cash operations, and real Paystack/SMS
integration all work. This final phase adds plan billing, statements/
exports, the remaining UI, and does the production-readiness pass.

Read first:
1. `docs/API_CONTRACT.md` Phase 4 section.
2. `functions/shared/constants.py` / `src/lib/constants.ts` — `PLANS` and
   `PLAN_ORDER` define every limit you're enforcing here.
3. `docs/IMPLEMENTATION_PLAN.md` — confirm Phases 1–3's checklists are
   actually all checked before starting; if something is missing, flag it
   rather than building around the gap.

**Build:**

1. `upgradePlan` — non-free plans go through the same payment-intent
   pattern as Phase 3 (prefix `MCP-`, already wired on the PAY side);
   downgrading to `free` is immediate. Retrofit plan-limit enforcement
   (`memberLimit`, `onlineCollection`, `smsRate`, `minutesQuota`,
   `exportsAllowed`) into the Phase 1/2/3 callables wherever it isn't
   already checked — cross-reference `docs/API_CONTRACT.md`'s "Errors"
   rows for each callable.
2. `generateStatement` — per-member or whole-chama PDF/CSV, respecting
   `exportsAllowed` and incrementing/checking
   `chamas.minutesExportsUsedThisMonth` against `minutesQuota`.
3. Live dashboard aggregation (whatever the demo's dashboard view
   computes from `db`, compute from real Firestore data — use aggregation
   queries or maintained counters, your call, but document which).
4. Wire every remaining demo screen to real data: Billing/Plan, Reports/
   Exports, Settings (admin side), and Home, My Contributions, My MGR, My
   Loans, Minutes, Messages, Profile (member side) — see the demo's `NAV`
   object for the full list per role.
5. End-to-end reconciliation: pick a test chama with members active on
   both the WhatsApp bot and the app, make payments through both
   channels, and confirm `totalContributed`/`creditBalance`/loan
   schedules agree regardless of which channel was used.
6. Production-readiness pass: re-read `firestore.rules` end to end against
   every callable built across all four phases and confirm no client-side
   direct write can bypass a callable's business logic; review Firestore
   composite-index coverage for every query added since Phase 1; add a TTL
   policy for `whatsappAuditLog` / `whatsappRateLimits` if not already
   present; confirm every Paystack/HostPinnacle secret is in Secret
   Manager, not in code or `.env` committed to git.

When done, mark `docs/IMPLEMENTATION_PLAN.md` complete and produce a short
go-live checklist as your final summary (domains, monitoring, backup
policy, who holds the Paystack/HostPinnacle production credentials).
