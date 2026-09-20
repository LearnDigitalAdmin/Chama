# MyChama — Cloud Function API Contract

Every `mychama1` Cloud Function callable, its owning phase, and its exact
request/response shape. `src/lib/callables.ts` is the frontend half of this
contract; the Python backend for each phase must implement callables under
these **exact names and shapes** — do not rename, do not add required
fields not listed here without updating this file and `callables.ts` in the
same change.

All callables:
- Require an authenticated caller (`req.auth`), except none — there is no
  anonymous callable in this system.
- Re-derive the caller's role server-side via
  `functions/shared/roles.py::require_role` (or a more specific helper) —
  never trust a `role` field passed in the request body.
- Raise `firebase_functions.https_fn.HttpsError` using the codes in
  `functions/shared/errors.py::ErrorCode` on failure.
- Live in `africa-south1` (must match `src/lib/firebase.ts`'s
  `getFunctions(app, region)` call and `functions/main.py`'s
  `set_global_options`).

---

## Phase 1 — Identity & Access

### `createChama`
Caller: any authenticated user with a **verified email** (checked via
`req.auth.token.email_verified`).
Creates the `chamas` doc, a `members` doc for the caller with
`role: "chair"`, `isAdmin: true`, `uid: <caller>`, and the matching
`userChamas/{uid}/memberships/{chamaId}` doc — all in one transaction.

```ts
Request:  { name: string; motto?: string; contributionAmount: number;
            contributionCycle: 'daily'|'weekly'|'monthly';
            adminName: string; adminPhone: string; adminIdNumber: string }
Response: { chamaId: string; memberId: string }
Errors:   failed-precondition (email not verified), invalid-argument
```

### `addAdmin` / `addMember`
Caller: `chair` or `treasurer` of `chamaId` (finance admin).
Creates a `members` doc (`uid: null`, `status: "active"`) and an `invites`
doc for the given phone. `addAdmin` additionally requires `role`; `addMember`
always creates `role: "member"`. Both enforce `PLANS[chama.plan].memberLimit`.

```ts
Request:  { chamaId: string; name: string; phone: string; idNumber: string;
            role?: 'chair'|'treasurer'|'secretary' }   // addAdmin only
Response: { memberId: string; inviteId: string }
Errors:   permission-denied, resource-exhausted (member limit reached),
          already-exists (phone already a member of this chama)
```

### `claimInvite`
Caller: any authenticated user whose phone (from their Auth record, or
passed and re-verified against `req.auth.token.phone_number` for phone
auth) matches a pending invite.
Sets `members.uid`, flips `invites.status` to `claimed`.

```ts
Request:  { chamaId: string; inviteId: string }
Response: { memberId: string; role: MemberRole }
Errors:   not-found, failed-precondition (invite already claimed/expired),
          permission-denied (phone mismatch)
```

### `completeProfile`
Caller: any authenticated user who signed in via Google and has no
`members` doc yet for the given `chamaId` (or globally, if `chamaId`
omitted — used right after first Google sign-in before the user has picked
a chama).

```ts
Request:  { chamaId?: string; phone: string; idNumber?: string }
Response: { memberId: string | null }
Errors:   invalid-argument (phone fails normalizePhone validation)
```

### `updateMember`
Caller: `chair`/`treasurer` (any field), or the member themself (name only).

```ts
Request:  { chamaId: string; memberId: string;
            patch: Partial<{ name: string; role: MemberRole;
                              status: 'active'|'inactive'|'suspended' }> }
Response: { ok: true }
Errors:   permission-denied
```

---

## Phase 2 — Core operations

### `recordCashContribution`
Caller: finance admin. Applies the shared "apply payment" transaction
(spill-forward) for a cash payment — same logic the webhook uses for
Paystack payments, `method: "manual"`, `ref` from
`functions/shared/ids.py::build_cash_reference`.

```ts
Request:  { chamaId: string; memberId: string; contributionId: string; amount: number }
Response: { ok: true; status: ContributionStatus }
```

### `applyLoan`
Caller: any active member (self). Server computes the schedule via
`functions/shared/loan_schedule.py::build_schedule` — the client never
sends a schedule.

```ts
Request:  { chamaId: string; productId: string; principal: number; term: number; purpose?: string }
Response: { loanId: string; installment: number; totalPay: number }
Errors:   invalid-argument (principal > product.maxAmount or term > product.maxTerm)
```

### `approveLoan`
Caller: `chair` or `treasurer`. Sets `approvals.{chair|treasurer} = true`
on decision `'approve'`; sets `status: 'rejected'` on `'reject'`. When both
approvals are true, status becomes `'approved'`.

```ts
Request:  { chamaId: string; loanId: string; decision: 'approve'|'reject'; note?: string }
Response: { ok: true; status: LoanStatus }
```

### `disburseLoanCash`
Caller: `treasurer`. Requires `status === 'approved'`. Sets `status:
'active'`, `disbursedOn`, `method: 'manual'`, re-bases every
`schedule[].dueDate` off today.

```ts
Request:  { chamaId: string; loanId: string }
Response: { ok: true }
```

### `recordCashLoanRepayment`
Caller: finance admin. Applies payment to the next unpaid installment(s),
spill-forward across installments same as contributions.

```ts
Request:  { chamaId: string; loanId: string; amount: number }
Response: { ok: true; remainingOutstanding: number }
```

### `createMgrPot`, `runMgrDraw`, `closeMgrPeriod`, `recordCashMgrPayment`
Caller: finance admin for all four. `runMgrDraw`'s `'smart'` algorithm must
be extracted from the attached demo HTML (search for the MGR draw
functions) — it is not present in the WhatsApp bot, which only reads pots,
never creates or draws them.

```ts
createMgrPot:
  Request:  { chamaId: string; name: string; amount: number;
              frequency: 'daily'|'weekly'|'monthly'; periodsPerRound: number;
              recipientsPerRound: number; memberIds: string[] }
  Response: { potId: string }

runMgrDraw:
  Request:  { chamaId: string; potId: string; method: 'smart'|'random' }
  Response: { queue: string[] }

closeMgrPeriod:
  Request:  { chamaId: string; potId: string }
  Response: { ok: true; nextPeriod: number }

recordCashMgrPayment:
  Request:  { chamaId: string; potId: string; recordId: string; amount: number }
  Response: { ok: true }
```

---

## Phase 3 — Payments, SMS & Settlement

### `setupSettlementAccount`
Caller: `chair`. First-time only (fails if `chamas.settlementSplitCode`
already set — use `requestSettlementChange` after that). Calls Paystack to
create a subaccount + split code, following the PAY repo's
`setupAccount`/`getOrCreateSplitCode` pattern, but using MyChama's own
Paystack secret.

```ts
Request:  { chamaId: string; accountLabel: string; accountType: 'paybill'|'till'|'bank';
            accountNumber?: string; bankCode?: string }
Response: { settlementSplitCode: string }
```

### `requestSettlementChange` / `approveSettlementChange`
Dual-officer approval for changing an already-configured settlement
account — request by one official, approval by a *different* official
(never self-approval), per `firestore.rules`'
`settlementAccountRequests` rules.

```ts
requestSettlementChange:
  Request:  { chamaId: string; accountLabel: string; accountType: 'paybill'|'till'|'bank';
              accountNumber?: string; bankCode?: string }
  Response: { requestId: string }

approveSettlementChange:
  Request:  { chamaId: string; requestId: string; decision: 'approve'|'reject' }
  Response: { ok: true }
  Errors:   permission-denied (approver === requester)
```

### `initiatePayment`
Caller: any active member. Mirrors CYBER's `mychama.payment.service.ts`
exactly — see `docs/ARCHITECTURE.md` §4.

```ts
Request:  { chamaId: string; purpose: 'contribution'|'loan_repayment'|'mgr_contribution';
            amount: number; phone: string;
            contributionId?: string; loanId?: string; potId?: string }
Response: { reference: string; grossAmount: number; paystackFee: number; ourFee: number }
Errors:   failed-precondition (chama.plan === 'free', online collection disabled),
          resource-exhausted (SECURITY.MAX_INTENTS_PER_HOUR exceeded)
```

### `purchaseSmsCredits`
Caller: finance admin. Reference prefix `MCS-`, collection `smsTopUps`.

```ts
Request:  { chamaId: string; amountKes: number; phone: string }
Response: { reference: string }
```

### `sendSmsCampaign`
Caller: `chair`/`treasurer`/`secretary`. Debits `smsCredits` at
`PLANS[plan].smsRate` per message before calling HostPinnacle directly.

```ts
Request:  { chamaId: string; audience: 'all'|'overdue'|'custom';
            memberIds?: string[]; message: string }
Response: { sent: number; creditsUsed: number }
Errors:   resource-exhausted (insufficient smsCredits — computed before sending, never partially sent)
```

---

## Phase 4 — Billing, reports & exports

### `upgradePlan`
Caller: `chair`. `plan !== 'free'` requires payment (prefix `MCP-`,
returns `{ reference }`); downgrading to `'free'` is immediate (`{ ok: true }`).

```ts
Request:  { chamaId: string; plan: ChamaPlan; phone: string }
Response: { reference: string } | { ok: true }
```

### `generateStatement`
Caller: finance admin (any member scope) or the member themself
(`memberId` must equal caller's own). Enforces
`PLANS[plan].exportsAllowed` and `minutesQuota` /
`minutesExportsUsedThisMonth`.

```ts
Request:  { chamaId: string; memberId?: string; from: string; to: string; format: 'pdf'|'csv' }
Response: { url: string }
Errors:   failed-precondition (exports not allowed on this plan, or quota exhausted)
```
