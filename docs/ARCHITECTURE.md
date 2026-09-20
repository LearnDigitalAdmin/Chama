# MyChama — System Architecture (Live Implementation)

This document is the map every standalone chat should read before writing
code. It explains *why* the global files are shaped the way they are, so a
chat working on one phase doesn't accidentally re-decide something another
phase already depends on.

## 1. The three repositories and what owns what

| Repo | Language | Role | Touched in which phase |
|---|---|---|---|
| **Chama** (this repo, `mychama1` Firebase project) | Python (Cloud Functions) + TypeScript/React (frontend) | The live product itself: Firestore data, rules, indexes, admin/member app, all business logic that isn't a payment webhook. | Phases 1–4 |
| **CYBER** | TypeScript | The existing WhatsApp bot. Already fully built for MyChama. Connects to `mychama1`'s Firestore via a **named secondary Admin app initialised with Application Default Credentials + IAM** (see `functions/src/config/mychama.config.ts`), not a service-account key file. **Read-only reference** — we do not modify this repo. | Referenced in Phases 1–3 |
| **PAY** | TypeScript | Hosts the **one singleton Paystack webhook** (`paystackCallback`) shared by every LearnDigital product, plus reusable Paystack (subaccount/split) and HostPinnacle SMS helpers. We **extend** this repo (new reference-prefix branches), we don't rebuild a webhook of our own. | Extended in Phase 3 |

`mychama1`'s Python functions and CYBER's TypeScript bot are **peers**: both
read/write the same `mychama1` Firestore, both create `paymentIntents`
documents, neither one is "the backend" for the other. The PAY repo's
webhook is the only thing that ever marks money as received.

## 2. Single-writer rule for money

Every financial figure in Firestore (`totalContributed`, `creditBalance`,
contribution `paidAmount`, loan `schedule[].paidAmount`, MGR record
`status`) is mutated by exactly one of two code paths, never a third:

1. **The PAY repo's webhook**, for anything paid via Paystack (STK push from
   either WhatsApp or the app). The webhook reads the `paymentIntents`
   document by `reference` (which is also the Firestore document ID —
   built-in idempotency: a replayed webhook event finds `status: success`
   already set and does nothing).
2. **A `mychama1` Python callable**, for anything paid in cash and recorded
   by a finance admin (`record_cash_contribution`, `disburse_loan_cash`,
   `record_cash_loan_repayment`, `record_cash_mgr_payment`).

Nothing else — no Firestore trigger, no scheduled function, no frontend
code — ever writes to these fields directly. Both paths run the exact same
"apply payment" transaction logic (spill-forward across partial periods,
update running totals, write a `transactions` doc), which is why that logic
is defined once, in `functions/shared/`, and imported by both the webhook's
Python-callable-adjacent logic (ported to TypeScript for the PAY repo, kept
value-identical) and every cash-recording callable.

## 3. Auth model

Three sign-in methods, one Firebase Auth project (`mychama1`):

- **Phone (primary, members).** `signInWithPhoneNumber` + invisible
  reCAPTCHA. A member only ever does this once thanks to session
  persistence (§5) — subsequent visits are silent.
- **Google (secondary, everyone).** `signInWithPopup(GoogleAuthProvider)`.
  Google gives us a verified email and a name but never a Kenyan phone
  number or ID number, both of which the schema requires
  (`members.phoneNormalized`, `members.idNumber`). Immediately after a
  first-time Google sign-in, the client calls `completeProfile` to collect
  the missing fields before the account is usable for anything
  money-related.
- **Email + password (primary, admins).** `createUserWithEmailAndPassword`
  + `sendEmailVerification`. A chair creating a brand-new chama must verify
  their email before `createChama` will succeed (checked server-side via
  `req.auth.token.email_verified`, never trusted from the client alone).

### Invite & claim flow

The original WhatsApp-only design assumed a member's phone number *was*
their identity — no separate auth step. The app needs a Firebase Auth `uid`
attached to each `members` doc, but a finance admin still needs to be able
to add a member who hasn't opened the app yet (exactly like today's "Add
Member" screen in the demo). This is solved with a new collection,
`chamas/{chamaId}/invites/{inviteId}` (see `Invite` in `src/lib/types.ts` /
`functions/shared/types.py`):

1. Admin calls `addMember` / `addAdmin` → creates a `members` doc with
   `uid: null` **and** an `invites` doc carrying the same phone number.
2. When that phone number (or the Google email, if the admin used email
   instead) signs in for the first time, the client looks up a pending
   invite by phone/email and calls `claimInvite`, which sets `members.uid`
   and flips the invite to `claimed`.
3. `on_member_write` (Firestore trigger) keeps
   `userChamas/{uid}/memberships/{chamaId}` in sync any time a `members`
   doc's `uid`, `role`, or `status` changes — this is the doc
   `firestore.rules` and `functions/shared/roles.py` both read to authorise
   everything else, so it must never fall out of sync with `members`.

This does **not** change anything about how the WhatsApp bot works — it
still keys everything off `phoneNormalized` and doesn't care whether `uid`
is set.

## 4. Payment flow (app-initiated, mirrors the bot)

1. App calls `initiatePayment` (Python callable) with the purpose, amount,
   and payer's phone.
2. Callable computes the fee breakdown (`functions/shared/money.py`),
   builds a reference with prefix `MCA-` (`functions/shared/ids.py`),
   writes a `paymentIntents/{reference}` doc with `channel: "app"`, and
   calls Paystack's charge endpoint to trigger the STK push — this is a
   value-identical port of `mychama.payment.service.ts` from CYBER.
3. Member enters their M-Pesa/Airtel PIN on their phone.
4. Paystack calls the **PAY repo's** `paystackCallback`. It sees the `MCA-`
   prefix, loads the `mychama1` `paymentIntents` doc (via the new IAM-based
   secondary app — see §1), applies the same transactional "apply payment"
   logic the bot's webhook branch already uses for `MCW-`, and marks the
   intent `success`.
5. The app's Firestore listener on the relevant `contributions` / `loans` /
   `mgrPots/.../records` doc updates in real time — no polling needed,
   though `initiatePayment`'s caller may optionally poll
   `paymentIntents/{reference}.status` as a fallback.

## 5. Auth session persistence & cost control

`browserLocalPersistence` (see `src/lib/firebase.ts`) keeps a signed-in
session until explicit sign-out. Phone auth is billed per verification by
Firebase/Google — the whole point of persistence is that a member does
**not** re-trigger an SMS OTP on every visit. Money-moving actions do not
rely on session freshness for authorisation: every callable re-derives the
caller's role from `userChamas/{uid}/memberships/{chamaId}` server-side
(`functions/shared/roles.py`) on every single call, exactly mirroring what
`firestore.rules` does for direct client writes. A stale-but-valid session
can still be denied at the moment of the call if the admin's role changed
in the meantime.

## 6. SMS (HostPinnacle)

Unlike payments, MyChama's SMS sending does **not** go through the PAY
repo — `mychama1`'s own Python functions call the HostPinnacle API
directly, using the same request shape as PAY's helper (see the PAY repo
link in the Phase 3 prompt) but with MyChama's own HostPinnacle credentials
(Secret Manager, not hardcoded). Every send debits `chamas.smsCredits` at
the plan's `smsRate` (see `PLANS` in `functions/shared/constants.py`) before
dispatching, and logs to `chamas/{chamaId}/smsLog`.

SMS **credit top-ups** are a payment, so they *do* go through the PAY
webhook — reference prefix `MCS-`, collection `smsTopUps`, credited to
`chamas.smsCredits` on webhook success. Plan upgrades follow the identical
pattern with prefix `MCP-` and collection `planBilling`.

## 7. What's genuinely new vs. what already exists

Already fully specified and must be reused as-is, not redesigned:
- `firestoreData.json`, `firestore.rules`, `firestore.indexes.json` (root
  of this repo)
- Every fee/schedule/phone formula in CYBER's `mychama.service.ts` and
  `mychama.config.ts`
- The PAY repo's webhook dispatch pattern and HostPinnacle/Paystack helper
  shapes

Genuinely new for the live build (not in the original demo or the bot),
introduced by this global package:
- `invites` collection + claim flow (§3)
- `MCA-`, `MCS-`, `MCP-` reference prefixes and their `smsTopUps` /
  `planBilling` collections
- `userChamas/{uid}/memberships/{chamaId}` sync trigger
