# MyChama — Phase 3 Delivery + Cross-Cutting Work

This delivery covers more than "Phase 3" in the original plan — you asked
for the Phase 2 screens fixed to match the demo, full offline support, and
the hero section wired up, alongside Phase 3 itself. All of it is here,
together, because they touch the same files.

## Apply it

**Chama repo:**
```bash
cp -r /path/to/phase3-delivery/chama-repo/. /path/to/Chama/
cp -r /path/to/phase3-delivery/docs/. /path/to/Chama/docs/
cd /path/to/Chama
npm install
cd functions && pip install -r requirements.txt --break-system-packages && cd ..
```

Set the new secrets before deploying:
```bash
firebase functions:secrets:set MYCHAMA_PAYSTACK_SECRET_KEY
firebase functions:secrets:set MYCHAMA_HP_SMS_USERID
firebase functions:secrets:set MYCHAMA_HP_SMS_PASSWORD
firebase functions:secrets:set MYCHAMA_HP_SMS_APIKEY
firebase functions:secrets:set MYCHAMA_HP_SMS_SENDERID
firebase deploy --only functions,firestore:rules,firestore:indexes,hosting
```

**PAY repo** — this one's a patch, not a clone (it's a large existing
codebase I don't own the whole history of): `pay-repo-changes/index.ts` is
the complete file with the MyChama additions already in place, verified
with `tsc --noEmit` against the real repo's dependencies. Diff it against
your current `functions/src/index.ts` and apply the MyChama-related
sections (search for `MYCHAMA` / `MyChama` — everything added is grouped
and commented). You'll also need:
```bash
firebase functions:secrets:set MYCHAMA_HP_SMS_USERID
firebase functions:secrets:set MYCHAMA_HP_SMS_PASSWORD
firebase functions:secrets:set MYCHAMA_HP_SMS_APIKEY
firebase functions:secrets:set MYCHAMA_HP_SMS_SENDERID
```
**And an IAM grant, outside code:** the PAY project's default compute
service account needs the "Firebase Admin" role on the `mychama1` Google
Cloud project — the exact same grant CYBER already has. Without it,
`mychamaDb()` will fail at runtime with a permission error, not a code bug.

## What's in here, by your request

### 1. Phase 3 backend — Paystack, HostPinnacle, settlement
- `functions/mychama/payments.py`: `setupSettlementAccount`,
  `requestSettlementChange`, `approveSettlementChange`, `initiatePayment`
  — a faithful port of CYBER's payment service, same fee math, same
  reference format (prefix `MCA-` instead of `MCW-`).
- `functions/mychama/sms.py`: `sendSmsCampaign` (direct HostPinnacle
  calls, MyChama's own credentials), `purchaseSmsCredits`, and
  `run_sms_schedules` (every 15 minutes).
- `functions/shared/paystack.py` / `hostpinnacle.py`: the HTTP-call
  helpers both of the above use — structurally mirrored from the PAY
  repo's own `chargeCustomer`/`setupAccount` functions so a MyChama charge
  looks like every other product's charge to Paystack and to the webhook.
- **PAY repo**: `mychamaDb()` (lazy, IAM-based, named "mychama" app —
  exactly CYBER's pattern), `determineChargeType` extended with
  `MCW-`/`MCA-`/`MCS-`/`MCP-`, and `handleMyChamaPayment` /
  `handleMyChamaSmsTopup` / `handleMyChamaPlanBilling` wired into both the
  `charge.success` and `charge.failed` branches of `paystackCallback`.
- **One placeholder you must fill in before go-live**: `payments.py`'s
  `PAYBILL_BANK_CODE`/`TILL_BANK_CODE` are marked `TODO`. I did not invent
  a Paystack Kenya bank code for M-Pesa paybill/till subaccounts without
  being able to verify it against Paystack's live `/bank` list. Guessing
  wrong here means settlement money has nowhere valid to land, so I left
  it as an explicit blocker rather than a silent guess.

### 2. Offline support — full design in `docs/OFFLINE.md`
Two mechanisms, because callables and direct writes need different ones:
- **Direct Firestore writes** (loan application/approval, loan products,
  minutes) now work offline for free — `src/lib/firebase.ts` switched to
  `initializeFirestore` with `persistentLocalCache` +
  `persistentMultipleTabManager`. No app code needed this; it's
  configuration.
- **Callables** (every money-moving action) go through a new
  `src/lib/offlineQueue.ts` — an IndexedDB-backed queue with
  server-side idempotency (`functions/shared/idempotency.py`, retrofitted
  into every Phase 1/2/3 money-or-state-mutating callable) so a queued
  action that actually succeeded server-side, but whose response never
  reached the device, is safe to retry — the server returns the original
  result instead of applying it twice. `src/lib/callables.ts` splits every
  callable into queueable (`callable()`) vs. not (`liveCallable()`) — the
  ones needing a live round trip by nature (STK push, immediate
  navigation) fail clearly instead of silently queuing something the
  person is actively waiting on.
- `src/app/SyncPill.tsx` — the sidebar/topbar sync indicator and offline
  banner, matching the demo's own `syncPill`/`#offlineBanner` concept.

### 3. Hero section
`src/marketing/Hero.tsx` — the public "/" route for signed-out visitors,
ported from the demo's actual hero/stat-strip/features copy and Tailwind
classes (same forest/gold palette, Space Grotesk + Inter). One honest
scope note: I ported the hero, stat strip, and features grid — the demo's
fuller marketing site (how-it-works, pricing, FAQ sections) is not
included; the structure is there to extend the same way if you want the
rest ported later.

### 4. Every screen restyled to the demo's real design system
`src/index.css` now carries the demo's actual design tokens (forest/gold/
brick/ink/paper palette, Space Grotesk + Inter, `.card`/`.btn-primary`/
`.chip`/`.nav-item` classes) — pulled directly from the demo's
`tailwind.config`, not approximated. `AppShell.tsx` was rebuilt to match
the demo's actual structure: a desktop sidebar, a topbar with a user
menu, an offline banner, and a mobile bottom nav with a "More" sheet —
including the exact per-role `NAV`/`BOTTOM_NAV` structure from the demo's
own JS (`src/app/navConfig.ts`). Every Phase 1/2 screen (auth, Members,
Loans, Contributions, MGR, Minutes) was rebuilt on top of this. Sections
not yet built (Exports, Plan & Billing, Settings, Messages — all Phase 4)
show a `<ComingSoon>` placeholder rather than a broken link, so the nav is
complete even though those screens aren't.

### 5. Client vs. server split — reviewed, not just carried over
You asked me to double-check this. I didn't find a case this phase where
`firestore.rules` was blocking something that needed to move server-side —
every new client-writable thing (loan application/approval, loan products,
minutes, already established in Phase 2) stays a direct write; every new
server-only thing (payments, settlement, SMS) genuinely needs the server
because it touches Paystack/HostPinnacle credentials or cross-document
money logic a security rule can't safely express. So: no rules were
loosened this phase, because nothing needed it — I checked rather than
assumed, and if a future phase does hit a real restriction, I'll adjust
the rule and say so explicitly, the same way I've flagged every other
deviation from the original plan in these delivery notes.

## Verification performed
- **Python**: all 25 callables/triggers/scheduled functions (7 Phase 1 +
  11 Phase 2 + 7 Phase 3) import cleanly through `main.py` with real
  `firebase_functions`/`firebase_admin`/`requests` installed. The MGR
  engine's late-score decay and the phone/masking helpers were
  functionally re-tested after Phase 3 changes.
- **TypeScript (Chama repo)**: `tsc -b --noEmit` clean, full `vite build`
  succeeds (83 modules, no warnings).
- **TypeScript (PAY repo)**: `npx tsc --noEmit` clean against the actual
  existing 3,000+ line file with my additions applied — this is real
  verification against your real codebase, not a guess.
- **Not verified**: live Paystack/HostPinnacle calls (need real
  credentials and a live project), the IAM grant's actual effect (needs
  your GCP console), and offline behavior in an actual browser (IndexedDB/
  Firestore persistence is standard, well-documented SDK behavior, but I
  can't drive a real browser's network toggle in this environment).

---

## Are we on track for a production-ready live implementation after Phase 4?

Short answer: **for a real cash + Paystack + SMS MVP, yes — for
"production-ready" in the fuller sense, mostly, with some things that are
genuinely outside what code delivers.**

**What Phase 4 (as scoped) will close:**
- Plan billing/upgrade, statement/export generation, the remaining
  screens (member-side views, Settings, Billing, Exports).
- The end-to-end reconciliation pass — same chama, same member, paying
  through both the WhatsApp bot and the app, confirming both channels
  agree on balances. This is the pass that would have caught things like
  the reference-format mismatch I found and fixed this phase, so it's not
  a formality.
- The security-rules and index audit against everything built across all
  four phases, and the `whatsappAuditLog`/`whatsappRateLimits` TTL policy.

**What's genuinely ready now, ahead of Phase 4:** identity/access, core
operations (contributions, loans, MGR, minutes), and now payments/SMS/
settlement, offline support, and the real UI — that's the bulk of what a
chama actually does day to day.

**What "production-ready" needs that isn't a Phase 4 code task:**
- Paystack and HostPinnacle production account approval (not sandbox) —
  that's an external business process, not something I can do from here.
- The `PAYBILL_BANK_CODE`/`TILL_BANK_CODE` placeholder above, resolved
  against Paystack's real bank list.
- Real load/cost testing — Firestore reads, scheduled function frequency,
  and SMS costs all scale with real usage in ways a code review can't
  fully predict.
- Monitoring/alerting (Cloud Functions error rates, failed webhook
  events, stuck payment intents) and a support process for when something
  does go wrong with a group's money — this is a product/ops decision as
  much as an engineering one.
- A legal/compliance review appropriate to handling other people's group
  savings in Kenya — genuinely outside what I can assess.

So: Phase 4 gets you to a complete, coherent, code-ready product. The
handful of items above are real, and worth planning for explicitly rather
than assuming "Phase 4 done" means "fully live" — but none of them are
signs the architecture needs rework; they're the normal gap between "the
code is done" and "the business is live."
