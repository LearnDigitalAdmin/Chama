# MyChama — Conventions (read this before writing any code)

## 1. Source of truth hierarchy

When two things disagree, this is the order that wins:

1. `firestoreData.json`, `firestore.rules`, `firestore.indexes.json`
   (root of the Chama repo) — the schema contract.
2. `functions/shared/*.py` and `src/lib/*.ts` (this global package) —
   values and formulas.
3. `docs/API_CONTRACT.md` — callable shapes.
4. CYBER's `mychama.*.ts` files — reference implementation for anything
   the global package doesn't already cover (e.g. message copy, WhatsApp
   nav state machine — irrelevant to the app).
5. The attached demo HTML — UI/UX and any algorithm not yet ported
   anywhere else (e.g. the MGR smart-draw logic).

If the demo HTML's numbers ever disagree with `firestoreData.json` /
`functions/shared/constants.py`, the constants file wins and the demo is
treated as stale.

## 2. Golden rule for every standalone chat

**Import from the shared package. Never redefine.** If a chat needs a fee
formula, a phone regex, a collection name, a Firestore path, or a callable
name, it comes from `functions/shared/` or `src/lib/`. If something is
missing, the chat should say so and add it to the shared package (in a
clearly-flagged, minimal addition) rather than inlining a local copy that
will silently drift.

## 3. Naming

- Firestore document IDs: `camelCase` field names, `snake_case` is never
  used in Firestore. Loan products use slug IDs
  (`functions/shared/ids.py::slugify`) e.g. `flat_emergency`; everything
  else uses Firestore auto-IDs **except** `paymentIntents`, `smsTopUps`
  and `planBilling`, whose document ID **is** the payment `reference`.
- Python: `snake_case` for functions/variables, `PascalCase` for
  TypedDicts, `SCREAMING_SNAKE_CASE` for constants — standard PEP 8,
  matching `functions/shared/`.
- TypeScript: `camelCase` for functions/variables, `PascalCase` for
  types/interfaces, `SCREAMING_SNAKE_CASE` for constant objects — matching
  `src/lib/`.
- Cloud Function (callable) names are `camelCase` and match
  `docs/API_CONTRACT.md` exactly, e.g. `recordCashContribution` — Python
  functions are registered with this exact string even though the Python
  function implementing them is `snake_case`, e.g.:
  ```python
  @https_fn.on_call(region="africa-south1")
  def recordCashContribution(req: https_fn.CallableRequest): ...
  ```

## 4. Money & dates

- All money fields are `number`/`float`, always passed through `round2()`
  before being written. Never store money as a formatted string.
- Calendar-day fields (`paidOn`, `dueDate`, `joinDate`, `date`,
  `requestedOn`, `disbursedOn`) are ISO date strings `YYYY-MM-DD`.
- Timestamps (`createdAt`, `updatedAt`, intent `expiresAt`) are epoch
  **milliseconds**, plain numbers — not Firestore `Timestamp` objects,
  to match the bot's clock and keep numeric range queries cheap.
- `periodKey` on contributions is always `YYYY-MM`.

## 5. Reference prefix registry

**This registry only grows by adding a row here first.** A chat must never
invent a new prefix inline in a handler.

| Prefix | Meaning | Owning collection | Created by |
|---|---|---|---|
| `MCW-` | WhatsApp bot payment | `paymentIntents` | CYBER (existing, don't touch) |
| `MCA-` | App payment | `paymentIntents` | `mychama1` Python (`initiatePayment`) |
| `MCS-` | SMS credit top-up | `smsTopUps` | `mychama1` Python (`purchaseSmsCredits`) |
| `MCP-` | Plan billing | `planBilling` | `mychama1` Python (`upgradePlan`) |

Format: `{PREFIX}-{chamaId}-{purposeCode}-{epochMs}-{rand6}` for
`MCW-`/`MCA-` (purpose code is `CNT`/`LNR`/`MGR`); `{PREFIX}-{chamaId}-{epochMs}-{rand6}`
(no purpose code) for `MCS-`/`MCP-`. Cash transactions use
`CASH{rand6}` (no chama/purpose encoded — cash never touches the webhook).

## 6. Firestore security rules are not optional in Python

The Admin SDK bypasses `firestore.rules` completely. Every callable that
isn't a pure self-service action must call the matching helper in
`functions/shared/roles.py` and must produce the **same** allow/deny
decision `firestore.rules` would produce for the equivalent direct client
write. When in doubt, open `firestore.rules` and find the matching rule
before writing the callable.

## 7. What each standalone chat should NOT do

- Don't touch CYBER. It's a read reference only.
- Don't build a second Paystack webhook. All webhook logic is an
  **addition** to the PAY repo's existing singleton `paystackCallback`.
- Don't invent new Firestore fields without adding them to
  `functions/shared/types.py` **and** `src/lib/types.ts` **and** noting the
  addition at the top of the PR/commit message, since another chat may be
  relying on the field not existing yet.
- Don't hardcode Paystack/HostPinnacle secrets — always Secret Manager /
  `firebase functions:secrets:set`, referenced by name only.
