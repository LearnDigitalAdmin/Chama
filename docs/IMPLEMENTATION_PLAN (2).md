# MyChama — Phased Implementation Plan

Four phases. Each phase has its own standalone-chat prompt in `prompts/`.
A phase should not start until the previous phase's checklist is done and
pushed — later phases assume earlier collections/callables/rules exist.

## Phase 1 — Identity & Access Foundation
**Repo needed:** Chama (with this global package committed) + demo HTML attached.

- [ ] Firebase Auth providers live: phone (with reCAPTCHA), Google, email/password
- [ ] `createChama` callable (bootstraps chair + chama + membership index)
- [ ] `addAdmin` / `addMember` callables + `invites` collection
- [ ] `claimInvite`, `completeProfile` callables
- [ ] `on_member_write` Firestore trigger syncing `userChamas/{uid}/memberships/{chamaId}`
- [ ] `updateMember` callable
- [ ] `firestore.rules` / `firestore.indexes.json` deployed and tested against real auth
- [ ] Minimal frontend: sign-up/sign-in screens (all 3 methods), create-chama flow,
      role-based redirect, session persistence verified (no repeat OTP on reload)

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

- [ ] `setupSettlementAccount`, `requestSettlementChange`, `approveSettlementChange`
- [ ] `initiatePayment` (mirrors CYBER's payment service) — `mychama1` side
- [ ] **PAY repo:** initialise a named secondary `mychama1` Admin app via IAM
      (same pattern as CYBER's `mychama.config.ts`)
- [ ] **PAY repo:** extend `determineChargeType` + `paystackCallback` with
      `MCW-`/`MCA-`/`MCS-`/`MCP-` handling, sharing one apply-payment function
- [ ] HostPinnacle direct integration in `mychama1`: `sendSmsCampaign`,
      scheduled `smsSchedules` dispatch, credit deduction
- [ ] `purchaseSmsCredits` (MCS- flow, credited by the extended webhook)
- [ ] Wire Payments & Settlement + Communication (SMS) demo views to live data

## Phase 4 — Billing, Reports & Cutover
**Repo needed:** Chama + demo HTML attached.

- [ ] `upgradePlan` (MCP- flow) + plan-limit enforcement wired into Phase 1/2 callables
- [ ] `generateStatement` / minutes export respecting `PLANS[plan]` quotas
- [ ] Live dashboard aggregation
- [ ] Remaining views wired: Billing, Reports/Exports, Settings, and all
      member-side views (My Contributions, My MGR, My Loans, Messages, Profile)
- [ ] End-to-end reconciliation check against the WhatsApp bot (same member,
      same chama, both channels agree on balances)
- [ ] Security rules audit, cost/quota review, `whatsappAuditLog` TTL policy,
      go-live checklist
