# MyChama — Phase 2 Prompt: Core Chama Operations (cash-only)

Paste this into a fresh chat, attach the demo file `MyChama_3_1.html`, and
attach/connect the **Chama** repo — Phase 1 must already be merged (auth,
membership index, and roles working) before starting this.

Optionally attach the **CYBER** repo
(`https://github.com/LearnDigitalAdmin/CYBER`) read-only, specifically
`functions/src/services/mychama.service.ts` and
`mychama.statement.service.ts`, if you need to see how the WhatsApp bot
already implements a piece of logic that isn't fully covered by the global
`functions/shared/` package.

---

I'm continuing the live build of MyChama on Firebase project `mychama1`
(Python Cloud Functions). Phase 1 (auth, chama creation, membership index)
is done. This phase builds the core day-to-day chama operations — cash
transactions only; Paystack/online payments are Phase 3, don't build them
here.

Before writing any code, read:
1. `docs/ARCHITECTURE.md` §2 (single-writer rule for money) — the cash
   callables you're building in this phase are one of the two legitimate
   writers of financial fields; nothing else may touch them.
2. `docs/CONVENTIONS.md` — especially §4 (money & dates) and §6 (rules
   parity — every callable must reproduce what `firestore.rules` would
   decide for the equivalent client write).
3. `docs/API_CONTRACT.md` Phase 2 section.
4. `functions/shared/loan_schedule.py` / `src/lib/loanSchedule.ts` and
   `functions/shared/money.py` / `src/lib/money.ts` — the schedule and fee
   math already exists; call it, don't reimplement it.

**Build, in this order:**

1. Loan products CRUD (finance-admin only, per `firestore.rules`).
2. Contribution cycle generation: a scheduled function that opens a new
   `contributions` doc per active member each `contributionCycle`, plus
   `recordCashContribution` and a scheduled overdue-sweep function.
3. Loan lifecycle: `applyLoan` (server builds the schedule via
   `build_schedule`, never trust a client-sent schedule), `approveLoan`
   (dual chair+treasurer approval), `disburseLoanCash`,
   `recordCashLoanRepayment`, and a scheduled overdue-sweep for loans.
4. Merry-Go-Round: `createMgrPot`, `runMgrDraw`, `closeMgrPeriod`,
   `recordCashMgrPayment`. **The smart/random draw algorithm and the
   period-close/queue-reorder logic (including `autoDemoteLate`) are not
   in the WhatsApp bot** — extract them from the attached demo HTML
   (search it for the MGR draw and period-close functions) and port them
   faithfully to Python; add the ported version to
   `functions/shared/mgr_engine.py` (new file, following the doc-comment
   convention of the other `functions/shared/` modules) so Phase 3/4 and
   the frontend can both reference the same logic description.
5. Minutes CRUD.
6. Wire the demo's Members, Contributions, Loans, MGR, and Minutes screens
   to real Firestore `onSnapshot` listeners and the callables above,
   replacing every `localStorage`/`db` reference for these sections. Keep
   the demo's existing visual design and interaction patterns — only the
   data layer changes.

**Out of scope:** anything Paystack, anything SMS, anything billing/plan —
those are Phase 3/4.

When done, update `docs/IMPLEMENTATION_PLAN.md`'s Phase 2 checklist and
flag anything you added to the shared package (especially the new
`mgr_engine.py`/`mgrEngine.ts` pair) so Phase 3/4 chats know it exists.
