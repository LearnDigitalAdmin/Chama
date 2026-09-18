# Firestore index rationale — MyChama (`mychama1`)

`firestore.indexes.json` must stay comment-free: the Firebase CLI rejects unknown keys in an index definition. The reasoning lives here instead, in the same order as the file.

## Composite indexes

- **`members`** (collection_group) — phoneNormalized ascending, status ascending
  - WhatsApp membership lookup: collection-group scan of every chama's members by verified phone. This is the first query of every My Chama session.
- **`members`** (collection) — status ascending, name ascending
  - App: member roster ordered by name, active first.
- **`members`** (collection) — isAdmin ascending, name ascending
  - App: officials list.
- **`contributions`** (collection) — memberId ascending, status ascending, periodKey ascending
  - Bot: a member's outstanding periods (status IN pending/partial/overdue, ordered by periodKey). Drives 'Pay Contribution'.
- **`contributions`** (collection) — memberId ascending, periodKey descending
  - Bot: contribution statement — newest periods first.
- **`contributions`** (collection) — periodKey ascending, status ascending
  - App: treasurer's collection sheet for one cycle.
- **`contributions`** (collection) — status ascending, dueDate ascending
  - Scheduled sweep: find unpaid contributions past their due date to mark overdue.
- **`loans`** (collection) — memberId ascending, requestedOn descending
  - Bot: a member's loans, newest first (loan balance, statements).
- **`loans`** (collection) — memberId ascending, status ascending, requestedOn descending
  - Bot: a member's loans filtered by status (repayable = active/overdue; duplicate check = pending_approval/awaiting_treasurer).
- **`loans`** (collection) — status ascending, requestedOn descending
  - App: approval queue across the whole chama.
- **`loans`** (collection) — source ascending, requestedOn descending
  - Ops: WhatsApp-originated applications, for channel reporting.
- **`transactions`** (collection) — memberId ascending, date descending
  - Bot: a member's ledger for the statement, with an optional date lower bound.
- **`transactions`** (collection) — type ascending, date descending
  - App: ledger filtered by transaction type.
- **`transactions`** (collection) — settled ascending, direction ascending, date ascending
  - Settlement run: unsettled money-in, oldest first.
- **`transactions`** (collection) — memberId ascending, type ascending, date descending
  - Reconciliation: a member's transactions by type over time.
- **`mgrPots`** (collection) — memberIds array-contains, status ascending
  - Bot: the pots a member belongs to that are collectable.
- **`mgrPots`** (collection) — status ascending, createdOn descending
  - App: active pots, newest first.
- **`records`** (collection) — memberId ascending, period descending
  - Bot: one member's history within a pot, newest period first.
- **`records`** (collection) — period ascending, status ascending
  - App: who has paid this period.
- **`records`** (collection) — status ascending, memberId ascending, period ascending
  - Late-payer scoring across all periods, used by autoDemoteLate.
- **`payouts`** (collection) — round descending, date descending
  - App: payout history for a pot.
- **`paymentIntents`** (collection) — memberId ascending, createdAt ascending
  - Bot: rolling-hour rate limit on payment intents per member.
- **`paymentIntents`** (collection) — memberId ascending, status ascending, createdAt descending
  - Bot: a member's pending intents, newest first.
- **`paymentIntents`** (collection) — status ascending, expiresAt ascending
  - Sweep: expire intents left pending past expiresAt.
- **`paymentIntents`** (collection_group) — purpose ascending, status ascending, createdAt descending
  - Reconciliation across all chamas by purpose and time.
- **`minutes`** (collection) — date descending, createdAt descending
  - App: minutes list, newest meeting first.
- **`settlements`** (collection) — status ascending, date descending
  - App: settlement history.
- **`settlementAccountRequests`** (collection) — status ascending, createdAt descending
  - App: pending settlement-account change requests.
- **`whatsappAuditLog`** (collection) — phone ascending, at descending
  - Ops: WhatsApp audit trail per phone, and failure triage.
- **`whatsappAuditLog`** (collection) — outcome ascending, action ascending, at descending

## Field overrides

- **`members.phoneNormalized`** — ascending / collection, ascending / collection_group
  - Single-field collection-group index on phoneNormalized. Required for the bot's primary lookup — Firestore's automatic single-field indexes are COLLECTION-scoped only, so without this the collectionGroup('members').where('phoneNormalized','==',x) query fails at runtime.
- **`members.uid`** — ascending / collection, ascending / collection_group
  - uid is looked up across chamas when linking an app account to existing memberships.
- **`members.idNumber`** — exempted from indexing
  - Never indexed: the full National ID is written and read by document key only. Dropping its index removes it from every range scan and shrinks write cost.
- **`loans.schedule`** — exempted from indexing
  - Loan schedules are large arrays read and written whole; indexing them would add an index entry per instalment field on every write for no query benefit.
- **`loans.purpose`** — exempted from indexing
  - Free-text fields that are never filtered on.
- **`minutes.agenda`** — exempted from indexing
- **`minutes.resolutions`** — exempted from indexing
- **`minutes.attendees`** — contains / collection
- **`smsLog.body`** — exempted from indexing
- **`whatsappAuditLog.detail`** — exempted from indexing
  - Audit payloads are arbitrary maps — indexing them invites unbounded index growth.

## Deploy

```bash
firebase use mychama1
firebase deploy --only firestore:indexes,firestore:rules
```

Composite index builds are asynchronous. Deploy indexes and let them reach *Enabled* in the console **before** pointing the WhatsApp bot at the project, or the first `My Chama` session fails on a missing-index error.
