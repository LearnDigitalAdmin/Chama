"""
Contributions — Phase 2.

recordCashContribution is a callable because firestore.rules deliberately
blocks clients from ever writing `paidAmount` or moving `status` away from
'pending' (see the rules file's contributions section) — the spill-forward
math is server-only so there is exactly one implementation. Opening a new
cycle's contributions and sweeping overdue ones are scheduled functions for
the same reason: rules allow a finance-admin client to CREATE a pending
contribution directly, but the intent here is that MyChama does this
automatically per chama on its own contribution cycle, not that an admin
manually creates one row per member every period.
"""

from __future__ import annotations

from firebase_functions import https_fn, scheduler_fn
from firebase_admin import firestore

from shared import firestore_paths as paths
from shared.constants import MC
from shared.dates import add_days_iso, now_ms, period_key_of, today_iso
from shared.errors import bad_request, not_found, require_auth
from shared.idempotency import already_applied, record_result
from shared.roles import require_finance_admin

REGION = "africa-south1"

# How many days after a period opens a contribution becomes overdue.
GRACE_DAYS = {"daily": 1, "weekly": 3, "monthly": 7}


def _db():
    return firestore.client()


def _apply_contribution_payment(db, chama_id: str, member_id: str, start_contribution_id: str, amount: float) -> float:
    """
    Spill-forward: applies `amount` to the given contribution, then any
    excess to that member's next unpaid periods in order, then banks
    whatever's left as member.creditBalance. Returns the amount ultimately
    banked as credit (0 if fully absorbed by due periods).

    Mirrors the demo's applyContributionPayment() exactly, translated to
    Firestore reads/writes inside a single batch.
    """
    contributions_ref = db.collection(paths.contributions(chama_id))
    all_for_member = list(contributions_ref.where("memberId", "==", member_id).stream())
    all_for_member.sort(key=lambda d: d.to_dict().get("periodKey", ""))

    start_idx = next((i for i, d in enumerate(all_for_member) if d.id == start_contribution_id), 0)

    remaining = amount
    ts = now_ms()
    batch = db.batch()
    applied_total = 0.0

    for doc in all_for_member[start_idx:]:
        if remaining <= 0.009:
            break
        data = doc.to_dict()
        due = data["amount"] - data.get("paidAmount", 0)
        if due <= 0.009:
            continue
        applied = min(due, remaining)
        new_paid = data.get("paidAmount", 0) + applied
        remaining -= applied
        applied_total += applied
        new_status = "paid" if new_paid >= data["amount"] - 0.01 else "partial"
        update = {"paidAmount": new_paid, "status": new_status, "updatedAt": ts}
        if new_status == "paid" and not data.get("paidOn"):
            update["paidOn"] = today_iso()
        batch.update(doc.reference, update)

    member_ref = db.document(paths.member(chama_id, member_id))
    member_snap = member_ref.get()
    member = member_snap.to_dict()
    credit_delta = round(remaining * 100) / 100 if remaining > 0.009 else 0

    batch.update(member_ref, {
        "creditBalance": member.get("creditBalance", 0) + credit_delta,
        "totalContributed": member.get("totalContributed", 0) + applied_total,
        "updatedAt": ts,
    })
    batch.commit()
    return credit_delta


@https_fn.on_call(region=REGION)
def recordCashContribution(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    member_id = data.get("memberId")
    contribution_id = data.get("contributionId")
    amount = data.get("amount")

    if not chama_id or not member_id or not contribution_id:
        raise bad_request("chamaId, memberId, and contributionId are required.")
    if not isinstance(amount, (int, float)) or amount <= 0:
        raise bad_request("amount must be a positive number.")

    db = _db()
    require_finance_admin(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    contribution_ref = db.document(paths.contribution(chama_id, contribution_id))
    contribution_snap = contribution_ref.get()
    if not contribution_snap.exists:
        raise not_found("Contribution not found.")

    ref = "CASH" + str(now_ms())[-8:]
    _apply_contribution_payment(db, chama_id, member_id, contribution_id, float(amount))

    db.collection(paths.transactions(chama_id)).document().set({
        "type": "contribution",
        "memberId": member_id,
        "amount": float(amount),
        "method": "manual",
        "ref": ref,
        "date": today_iso(),
        "settled": False,
        "direction": "in",
        "channel": "app",
        "createdAt": now_ms(),
    })

    updated = contribution_ref.get().to_dict()
    result = {"ok": True, "status": updated.get("status", "pending")}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


# ---------------------------------------------------------------------------
# Scheduled: open each active chama's next contribution cycle
# ---------------------------------------------------------------------------

def _cycle_due_today(cycle: str) -> bool:
    import datetime
    today = datetime.datetime.utcnow()
    if cycle == "daily":
        return True
    if cycle == "weekly":
        return today.weekday() == 0  # Monday
    if cycle == "monthly":
        return today.day == 1
    return False


@scheduler_fn.on_schedule(schedule="every day 00:05", region=REGION, timezone=scheduler_fn.Timezone("Africa/Nairobi"))
def open_contribution_cycles(event: scheduler_fn.ScheduledEvent) -> None:
    db = _db()
    ts = now_ms()

    chamas = db.collection(MC.CHAMAS).where("status", "==", "active").stream()
    for chama_doc in chamas:
        chama = chama_doc.to_dict()
        cycle = chama.get("contributionCycle", "monthly")
        if not _cycle_due_today(cycle):
            continue

        chama_id = chama_doc.id
        period_key = period_key_of()
        amount = chama.get("contributionAmount", 0)
        if amount <= 0:
            continue

        grace = GRACE_DAYS.get(cycle, 7)
        due_date = add_days_iso(grace)

        members = db.collection(paths.members(chama_id)).where("status", "==", "active").stream()
        batch = db.batch()
        writes = 0
        for member_doc in members:
            existing = list(
                db.collection(paths.contributions(chama_id))
                .where("memberId", "==", member_doc.id)
                .where("periodKey", "==", period_key)
                .limit(1)
                .stream()
            )
            if existing:
                continue
            contrib_ref = db.collection(paths.contributions(chama_id)).document()
            batch.set(contrib_ref, {
                "memberId": member_doc.id,
                "period": period_key,
                "periodKey": period_key,
                "amount": amount,
                "paidAmount": 0,
                "status": "pending",
                "method": None,
                "paidOn": None,
                "ref": None,
                "dueDate": due_date,
                "createdAt": ts,
                "updatedAt": ts,
            })
            writes += 1
            if writes >= 400:  # stay well under the 500-write batch limit
                batch.commit()
                batch = db.batch()
                writes = 0
        if writes:
            batch.commit()


@scheduler_fn.on_schedule(schedule="every day 00:15", region=REGION, timezone=scheduler_fn.Timezone("Africa/Nairobi"))
def sweep_overdue_contributions(event: scheduler_fn.ScheduledEvent) -> None:
    db = _db()
    today = today_iso()
    ts = now_ms()

    chamas = db.collection(MC.CHAMAS).stream()
    for chama_doc in chamas:
        chama_id = chama_doc.id
        overdue_candidates = (
            db.collection(paths.contributions(chama_id))
            .where("status", "in", ["pending", "partial"])
            .stream()
        )
        batch = db.batch()
        writes = 0
        for doc in overdue_candidates:
            data = doc.to_dict()
            due = data.get("dueDate")
            if due and due < today:
                batch.update(doc.reference, {"status": "overdue", "updatedAt": ts})
                writes += 1
                if writes >= 400:
                    batch.commit()
                    batch = db.batch()
                    writes = 0
        if writes:
            batch.commit()
