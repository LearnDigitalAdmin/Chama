# MyChama — Phased Implementation Plan

Four phases. Each phase has its own standalone-chat prompt in `prompts/`.
A phase should not start until the previous phase's checklist is done and
pushed — later phases assume earlier collections/callables/rules exist.

## Phase 1 — Identity & Access Foundation
**Repo needed:** Chama (with this global package committed) + demo HTML attached.

- [x] Firebase Auth providers live: phone (`src/auth/PhoneSignIn.tsx`,
      reCAPTCHA), Google (`src/auth/GoogleSignIn.tsx`), email/password
      (`src/auth/EmailSignInAdmin.tsx`)
- [x] `createChama` callable (bootstraps chair + chama + membership index)
- [x] `addAdmin` / `addMember` callables + `invites` collection
- [x] `claimInvite`, `completeProfile` callables
- [x] `on_member_write` Firestore trigger syncing `userChamas/{uid}/memberships/{chamaId}`
- [x] `updateMember` callable
- [x] `firestore.rules` / `firestore.indexes.json` written and consistent
      with every callable's reads/writes — **not independently verified
      against a live deployment**; this checklist was never updated
      through Phases 1–3, so treat "deployed and tested against real auth"
      as outstanding until someone actually runs
      `firebase deploy --only firestore:rules,firestore:indexes` against
      `mychama1` and exercises it. See TOUCH_BASE.md "Go-live checklist".
- [x] Minimal frontend: sign-up/sign-in screens (all 3 methods), create-chama flow,
      role-based redirect (`src/auth/Home.tsx`, `src/app/AppShell.tsx`) —
      session persistence itself is Firebase Auth's default behaviour
      (`browserLocalPersistence`), not separately verified against a real
      device/browser from this repo

## Phase 2 — Core Chama Operations (cash-only, no Paystack yet)
**Repo needed:** Chama + demo HTML attached. Reference CYBER (read-only) for
service-layer formulas already ported into the global package, and for
anything the global package doesn't cover.

- [x] Loan products CRUD — **direct Firestore write** (finance-admin only,
      validated by `firestore.rules`), not a callable — see
      `docs/API_CONTRACT.md`'s Phase 2 correction note.
- [x] Contribution cycle generation (scheduled function:
      `open_contribution_cycles`) + `recordCashContribution` + overdue
      sweep (`sweep_overdue_contributions`)
- [x] Loan application and approval — **direct Firestore writes**, per
      `firestore.rules`, using `src/lib/loanSchedule.ts::buildSchedule`
      client-side. `disburseLoanCash`, `recordCashLoanRepayment` (callables,
      since rules block those specific writes) + `sweep_overdue_loans`
- [x] `createMgrPot`, `runMgrDraw` (ported the demo's smart/random draw
      logic into `functions/shared/mgr_engine.py`), `recordCashMgrPayment`,
      `closeMgrPeriod`, and `recordMgrPayoutCash` (added — see
      `docs/API_CONTRACT.md`)
- [x] Minutes CRUD — **direct Firestore write** (secretary/chair), not a
      callable
- [x] Wired the Members, Loan products, Loans, Contributions, MGR, and
      Minutes screens to real Firestore listeners + the callables above.
      Visual design is a plain, functional pass, not a recreation of the
      original demo's Tailwind styling — flagged as a deliberate scope
      trade-off in the Phase 2 delivery README.

## Phase 3 — Payments, SMS & Settlement
**Repo needed:** Chama + demo HTML attached. Also needs **PAY repo** (webhook
extension) and reference to **CYBER** (payment-service pattern to mirror).
This phase touches two repos — see the prompt for the split.

- [x] `setupSettlementAccount`, `requestSettlementChange`, `approveSettlementChange`
- [x] `initiatePayment` (mirrors CYBER's payment service) — `mychama1` side
- [x] **PAY repo:** initialised a named secondary `mychama1` Admin app via IAM
      (same pattern as CYBER's `mychama.config.ts`) — see `pay-repo-changes/index.ts`
- [x] **PAY repo:** extended `determineChargeType` + `paystackCallback` with
      `MCW-`/`MCA-`/`MCS-`/`MCP-` handling (both `charge.success` and
      `charge.failed`), TypeScript-verified against the real repo (`tsc --noEmit` clean)
- [x] HostPinnacle direct integration in `mychama1`: `sendSmsCampaign`,
      scheduled `run_sms_schedules` dispatch (every 15 min), credit deduction
- [x] `purchaseSmsCredits` (MCS- flow, credited by the extended webhook)
- [x] Wired Payments & Settlement + Communication (SMS) screens to live data
- [x] **Cross-cutting, done this phase rather than deferred:** full offline
      support (`docs/OFFLINE.md`) — Firestore persistent cache for direct
      writes, a custom IndexedDB queue with server-side idempotency for
      callables; a real Tailwind design system ported from the demo
      (`src/index.css`), the public marketing hero page (`src/marketing/Hero.tsx`),
      and every Phase 1/2 screen restyled to match

## Phase 4 — Billing, Reports & Cutover
**Repo needed:** Chama + demo HTML attached.

- [x] `upgradePlan` (MCP- flow) — plan-limit enforcement was already wired
      into `addAdmin`/`addMember`/`initiatePayment`/`sendSmsCampaign` back
      in Phases 1/3; this phase added the downgrade-blocked-by-memberLimit
      check and the pending-payment flow itself
- [x] `generateStatement` (member/whole-chama PDF/CSV from the
      `transactions` ledger) + minutes-PDF export, both respecting
      `PLANS[plan].exportsAllowed`/`minutesQuota`/`minutesExportsUsedThisMonth`
      — plus the monthly reset sweep that field was always missing
- [x] Live dashboard aggregation — `AdminDashboard`/`MemberDashboard`,
      small-scope `onSnapshot` listeners (see the file header for why, and
      the note on switching to `getCountFromServer` if a chama's history
      gets very large)
- [x] Remaining views wired: Billing, Reports/Exports, Settings, and all
      member-side views (My Contributions, My MGR, My Loans, Messages, Profile)
- [ ] End-to-end reconciliation check against the WhatsApp bot (same member,
      same chama, both channels agree on balances) — **not done**: needs a
      deployed project and a live WhatsApp bot session to check against,
      neither of which exist from inside this repo. See TOUCH_BASE.md.
- [x] Security rules audit — found and fixed: `autoRenew` unwritable by the
      chair, `smsLog` unreadable by plain members, `planBilling`/`smsTopUps`
      missing explicit rules, `storage.rules` still the wide-open
      `firebase init` placeholder. Added a narrow self-service "leave
      chama" rule. See TOUCH_BASE.md for the full list.
- [ ] Cost/quota review, `whatsappAuditLog` TTL policy — **not done**: TTL
      policies are a one-time `gcloud firestore fields ttl-policies` console
      action against a live project, not something expressible in this
      repo's files. See TOUCH_BASE.md "Go-live checklist".
- [x] Go-live checklist — see TOUCH_BASE.md
