"""
Loans — Phase 2.

Loan APPLICATION and APPROVAL are deliberately NOT callables — re-read
firestore.rules' `loans` section before changing that. Rules let a member
create their own 'pending_approval' loan directly (with a client-computed
schedule whose length must equal `term` — use
src/lib/loanSchedule.ts::buildSchedule so the client never freehands the
schedule), and let the chair/treasurer flip their own `approvals.*` flag
and advance `status` through a fixed small set of values directly. No
money moves at either step, so there's no spill-forward math to centralise
and the direct-write path is simpler and just as safe.

What IS a callable, and why: `status` can never become 'active' via a
direct client write (disbursement), and `schedule[].paidAmount` can never
be touched by a direct client write at all (repayment) — see the rules
file's loans `update` rule, which only permits changing
`['approvals', 'status', 'updatedAt']`. Both of those need the server.
"""

from __future__ import annotations

from firebase_functions import https_fn, scheduler_fn
from firebase_admin import firestore

from shared import firestore_paths as paths
from shared.constants import MC
from shared.dates import add_days_iso, now_ms, today_iso
from shared.errors import bad_request, not_found, precondition, require_auth
from shared.idempotency import already_applied, record_result
from shared.roles import require_finance_admin

REGION = "africa-south1"


def _db():
    return firestore.client()


@https_fn.on_call(region=REGION)
def disburseLoanCash(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    loan_id = data.get("loanId")
    if not chama_id or not loan_id:
        raise bad_request("chamaId and loanId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    loan_ref = db.document(paths.loan(chama_id, loan_id))
    loan_snap = loan_ref.get()
    if not loan_snap.exists:
        raise not_found("Loan not found.")
    loan = loan_snap.to_dict()

    if loan.get("status") != "approved":
        raise precondition("This loan isn't approved yet — both the chair and treasurer must approve first.")

    ts = now_ms()
    today = today_iso()

    # Re-base every installment's due date off today, keeping the original
    # spacing (n * 30 days), so a loan approved weeks after application
    # doesn't start with a stale first due date.
    new_schedule = []
    for installment in loan["schedule"]:
        installment = dict(installment)
        installment["dueDate"] = add_days_iso(installment["n"] * 30)
        new_schedule.append(installment)

    loan_ref.update({
        "status": "active",
        "disbursedOn": today,
        "method": "manual",
        "schedule": new_schedule,
        "updatedAt": ts,
    })

    db.collection(paths.transactions(chama_id)).document().set({
        "type": "loan_disbursement",
        "memberId": loan["memberId"],
        "amount": loan["principal"],
        "method": "manual",
        "ref": "CASH" + str(ts)[-8:],
        "date": today,
        "settled": False,
        "direction": "out",
        "channel": "app",
        "createdAt": ts,
    })

    result = {"ok": True}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def recordCashLoanRepayment(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    loan_id = data.get("loanId")
    amount = data.get("amount")

    if not chama_id or not loan_id:
        raise bad_request("chamaId and loanId are required.")
    if not isinstance(amount, (int, float)) or amount <= 0:
        raise bad_request("amount must be a positive number.")

    db = _db()
    require_finance_admin(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    loan_ref = db.document(paths.loan(chama_id, loan_id))
    loan_snap = loan_ref.get()
    if not loan_snap.exists:
        raise not_found("Loan not found.")
    loan = loan_snap.to_dict()

    if loan.get("status") not in ("active", "overdue"):
        raise precondition("This loan isn't active.")

    schedule = loan["schedule"]
    remaining = float(amount)
    for installment in schedule:
        if remaining <= 0.009:
            break
        due = installment["due"] - installment.get("paidAmount", 0)
        if due <= 0.009:
            continue
        applied = min(due, remaining)
        installment["paidAmount"] = installment.get("paidAmount", 0) + applied
        remaining -= applied
        installment["paid"] = installment["paidAmount"] >= installment["due"] - 0.01

    ts = now_ms()
    new_status = "completed" if all(s["paid"] for s in schedule) else "active"

    credit_delta = round(remaining * 100) / 100 if remaining > 0.009 else 0
    member_ref = db.document(paths.member(chama_id, loan["memberId"]))

    batch = db.batch()
    batch.update(loan_ref, {"schedule": schedule, "status": new_status, "updatedAt": ts})
    if credit_delta:
        member_snap = member_ref.get()
        member = member_snap.to_dict()
        batch.update(member_ref, {"creditBalance": member.get("creditBalance", 0) + credit_delta, "updatedAt": ts})
    batch.commit()

    db.collection(paths.transactions(chama_id)).document().set({
        "type": "loan_repayment",
        "memberId": loan["memberId"],
        "amount": float(amount),
        "method": "manual",
        "ref": "CASH" + str(ts)[-8:],
        "date": today_iso(),
        "settled": False,
        "direction": "in",
        "channel": "app",
        "createdAt": ts,
    })

    outstanding = round(sum(max(0, s["due"] - s.get("paidAmount", 0)) for s in schedule) * 100) / 100
    result = {"ok": True, "remainingOutstanding": outstanding}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@scheduler_fn.on_schedule(schedule="every day 00:20", region=REGION, timezone=scheduler_fn.Timezone("Africa/Nairobi"))
def sweep_overdue_loans(event: scheduler_fn.ScheduledEvent) -> None:
    db = _db()
    today = today_iso()
    ts = now_ms()

    chamas = db.collection(MC.CHAMAS).stream()
    for chama_doc in chamas:
        chama_id = chama_doc.id
        active_loans = db.collection(paths.loans(chama_id)).where("status", "==", "active").stream()
        batch = db.batch()
        writes = 0
        for doc in active_loans:
            loan = doc.to_dict()
            next_unpaid = next((s for s in loan["schedule"] if not s["paid"]), None)
            if next_unpaid and next_unpaid["dueDate"] < today:
                batch.update(doc.reference, {"status": "overdue", "updatedAt": ts})
                writes += 1
                if writes >= 400:
                    batch.commit()
                    batch = db.batch()
                    writes = 0
        if writes:
            batch.commit()
