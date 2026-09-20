# MyChama — Phase 3 Prompt: Payments, SMS & Settlement

This phase touches **two repositories** — do the `mychama1` (Chama repo)
work first, then the PAY repo webhook extension, in the same chat or a
follow-up with full context carried over. Attach the demo file
`MyChama_3_1.html`, the **Chama** repo, the **PAY** repo
(`https://github.com/LearnDigitalAdmin/PAY`), and read-only reference the
**CYBER** repo (`https://github.com/LearnDigitalAdmin/CYBER`) for
`functions/src/services/mychama.payment.service.ts` and
`functions/src/config/mychama.config.ts` — the exact pattern you're
mirroring/extending.

Phases 1 and 2 must already be merged.

---

I'm continuing the live build of MyChama. Phases 1 (auth) and 2 (core
cash operations) are done. This phase wires up real Paystack payments and
HostPinnacle SMS.

Read first:
1. `docs/ARCHITECTURE.md` §1, §4, §6 — repo ownership, the app-initiated
   payment flow end to end, and the SMS split between direct HostPinnacle
   calls (in `mychama1`) versus the PAY webhook (for SMS *credit
   purchases* only).
2. `docs/CONVENTIONS.md` §5 (reference prefix registry) — you're
   implementing the `MCA-`, `MCS-`, `MCP-` rows.
3. `docs/API_CONTRACT.md` Phase 3 section.

## Part A — `mychama1` (Chama repo), Python

1. `setupSettlementAccount`, `requestSettlementChange`,
   `approveSettlementChange` — subaccount + split code creation via
   Paystack, following the **shape** of the PAY repo's `setupAccount` /
   `getOrCreateSplitCode` functions but using MyChama's own Paystack
   secret key (Secret Manager) and writing to `chamas.settlementAccount` /
   `chamas.settlementSplitCode` per `firestoreData.json`.
2. `initiatePayment` — a faithful Python port of CYBER's
   `mychama.payment.service.ts`: build the fee breakdown
   (`functions/shared/money.py`), build an `MCA-` reference
   (`functions/shared/ids.py`), write the `paymentIntents` doc
   (`channel: "app"`), call Paystack to trigger the STK push.
3. `sendSmsCampaign` and a scheduled `smsSchedules` dispatcher — call
   HostPinnacle directly using MyChama's own HostPinnacle credentials
   (Secret Manager), debiting `chamas.smsCredits` at
   `PLANS[chama.plan].smsRate` **before** sending, logging to `smsLog`.
4. `purchaseSmsCredits` — same intent-creation pattern as `initiatePayment`
   but reference prefix `MCS-`, collection `smsTopUps`.

## Part B — PAY repo, TypeScript (the singleton webhook)

1. Add a named secondary Admin app for `mychama1`, initialised the same
   way CYBER's `functions/src/config/mychama.config.ts` does it —
   Application Default Credentials + IAM, **not** a service-account key
   file (unlike PAY's existing `project2App` pattern, which does use a key
   file — don't copy that part).
2. Extend `determineChargeType` to recognise `MCW-`, `MCA-`, `MCS-`, `MCP-`
   prefixes.
3. Extend `paystackCallback` with a `handleMyChamaCharge` function that:
   - Loads the intent doc from `mychama1` by reference (doc ID = reference
     — this is your idempotency check: if `status` is already `success`,
     return early).
   - For `MCW-`/`MCA-`: applies the same transactional "apply payment"
     logic Phase 2's cash callables use — port
     `functions/shared/money.py` / `loan_schedule.py`'s spill-forward
     behaviour to TypeScript inline in this handler (or find a way to
     share code between the Python and TS sides if your tooling allows
     it — otherwise a faithful, tested TS port is fine, since PAY is a
     separate Node project from `mychama1`).
   - For `MCS-`: increments `chamas.smsCredits`.
   - For `MCP-`: updates `chamas.plan` / `planExpiry`.
   - Writes a `transactions` doc, marks the intent `success` (or
     `failed`), and — mirroring the existing HostPinnacle helper already
     in this PAY repo — sends the member a confirmation SMS using
     MyChama's own HostPinnacle sender ID/credentials, not another
     product's.

**Out of scope:** loan disbursement via Paystack Transfers and MGR payout
via Paystack Transfers are **not** part of this phase — keep those
cash-only (already built in Phase 2). Automating outbound transfers is a
reasonable future enhancement once inbound payments are proven reliable in
production; flag it as such in your summary rather than building it.

When done, update `docs/IMPLEMENTATION_PLAN.md`'s Phase 3 checklist in
both repos' commits.
