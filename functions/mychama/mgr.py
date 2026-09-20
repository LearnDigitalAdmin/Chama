"""
Merry-Go-Round — Phase 2.

firestore.rules lets a finance admin write most fields on the pot document
directly (create, and any update except createdAt/createdOn — see the
mgrPots section). These are still implemented as callables, not direct
writes, for one reason: `records` and `payouts` are server-write-only
subcollections, and every meaningful MGR action (recording a contribution,
closing a period, paying out) has to touch one of those — so keeping the
pot-document mutations in the same callables as the records/payouts writes
means the draw algorithm and the close/payout logic each have exactly one
implementation, in functions/shared/mgr_engine.py.

recordMgrPayoutCash is a fifth callable beyond the four in the original
docs/API_CONTRACT.md Phase 2 listing — closeMgrPeriod only advances the
period and flags whether a round just completed; actually paying the
recipient(s) is a distinct, deliberate action (mirroring the demo's
separate "confirm payout" step), so it gets its own callable. Back-ported
into API_CONTRACT.md in this same change.
"""

from __future__ import annotations

from firebase_functions import https_fn
from firebase_admin import firestore

from shared import firestore_paths as paths
from shared import mgr_engine
from shared.dates import now_ms, today_iso
from shared.errors import bad_request, not_found, precondition, require_auth
from shared.idempotency import already_applied, record_result
from shared.roles import require_finance_admin

REGION = "africa-south1"


def _db():
    return firestore.client()


def _get_pot(db, chama_id: str, pot_id: str) -> tuple:
    pot_ref = db.document(paths.mgr_pot(chama_id, pot_id))
    pot_snap = pot_ref.get()
    if not pot_snap.exists:
        raise not_found("Merry-go-round pot not found.")
    return pot_ref, pot_snap.to_dict()


def _all_records(db, chama_id: str, pot_id: str) -> list[dict]:
    return [d.to_dict() | {"id": d.id} for d in db.collection(paths.mgr_records(chama_id, pot_id)).stream()]


@https_fn.on_call(region=REGION)
def createMgrPot(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    if not chama_id:
        raise bad_request("chamaId is required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    name = (data.get("name") or "Merry-go-round").strip()
    amount = data.get("amount")
    frequency = data.get("frequency")
    periods_per_round = data.get("periodsPerRound")
    recipients_per_round = data.get("recipientsPerRound")
    member_ids = data.get("memberIds") or []

    if not isinstance(amount, (int, float)) or amount <= 0:
        raise bad_request("amount must be a positive number.")
    if frequency not in ("daily", "weekly", "monthly"):
        raise bad_request("frequency must be daily, weekly, or monthly.")
    if not isinstance(periods_per_round, int) or periods_per_round < 1:
        raise bad_request("periodsPerRound must be a positive integer.")
    if len(member_ids) < 2:
        raise bad_request("Pick at least 2 members.")
    if not isinstance(recipients_per_round, int) or recipients_per_round < 1:
        recipients_per_round = 1
    recipients_per_round = min(recipients_per_round, len(member_ids) - 1 or 1)

    ts = now_ms()
    pot_ref = db.collection(paths.mgr_pots(chama_id)).document()
    pot_ref.set({
        "name": name,
        "amount": float(amount),
        "frequency": frequency,
        "periodsPerRound": periods_per_round,
        "recipientsPerRound": recipients_per_round,
        "memberIds": member_ids,
        "queue": [],
        "drawDone": False,
        "drawMethod": None,
        "autoDemoteLate": True,
        "status": "draft",
        "cycleNumber": 1,
        "period": 1,
        "createdOn": today_iso(),
        "createdAt": ts,
        "updatedAt": ts,
    })
    result = {"potId": pot_ref.id}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def runMgrDraw(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    method = data.get("method") or "smart"
    if not chama_id or not pot_id:
        raise bad_request("chamaId and potId are required.")
    if method not in ("smart", "random"):
        raise bad_request("method must be smart or random.")

    db = _db()
    require_finance_admin(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    pool = pot["memberIds"] if pot["status"] == "draft" else pot["queue"]
    records = _all_records(db, chama_id, pot_id)
    queue = mgr_engine.run_draw(records, pool, method)

    pot_ref.update({
        "queue": queue,
        "drawDone": True,
        "drawMethod": method,
        "status": "active",
        "updatedAt": now_ms(),
    })
    result = {"queue": queue}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def recordCashMgrPayment(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    member_id = data.get("memberId") or data.get("recordId")  # tolerate either name
    amount = data.get("amount")

    if not chama_id or not pot_id or not member_id:
        raise bad_request("chamaId, potId, and memberId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    if pot["status"] != "active":
        raise precondition("This pot isn't in an active collection period.")

    use_amount = float(amount) if isinstance(amount, (int, float)) and amount > 0 else pot["amount"]
    ts = now_ms()
    today = today_iso()

    # One record per (member, period) — update if it already exists (e.g.
    # correcting a 'missed' mark), else create.
    existing_q = (
        db.collection(paths.mgr_records(chama_id, pot_id))
        .where("memberId", "==", member_id)
        .where("period", "==", pot["period"])
        .limit(1)
        .stream()
    )
    existing = list(existing_q)

    if existing:
        existing[0].reference.update({"status": "paid", "amount": use_amount, "date": today, "method": "manual", "updatedAt": ts})
    else:
        db.collection(paths.mgr_records(chama_id, pot_id)).document().set({
            "period": pot["period"],
            "memberId": member_id,
            "status": "paid",
            "amount": use_amount,
            "date": today,
            "method": "manual",
            "createdAt": ts,
            "updatedAt": ts,
        })

    db.collection(paths.transactions(chama_id)).document().set({
        "type": "mgr_contribution",
        "memberId": member_id,
        "amount": use_amount,
        "method": "manual",
        "ref": "CASH" + str(ts)[-8:],
        "date": today,
        "settled": False,
        "direction": "in",
        "channel": "app",
        "note": pot["name"],
        "createdAt": ts,
    })

    result = {"ok": True}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def closeMgrPeriod(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    if not chama_id or not pot_id:
        raise bad_request("chamaId and potId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    if pot["status"] != "active":
        raise precondition("This pot isn't in an active collection period.")

    ts = now_ms()
    today = today_iso()

    # Anyone with no record for this period is marked missed.
    have_records = {
        d.to_dict()["memberId"]
        for d in db.collection(paths.mgr_records(chama_id, pot_id)).where("period", "==", pot["period"]).stream()
    }
    batch = db.batch()
    for member_id in pot["memberIds"]:
        if member_id not in have_records:
            rec_ref = db.collection(paths.mgr_records(chama_id, pot_id)).document()
            batch.set(rec_ref, {
                "period": pot["period"],
                "memberId": member_id,
                "status": "missed",
                "amount": pot["amount"],
                "date": today,
                "method": None,
                "createdAt": ts,
                "updatedAt": ts,
            })
    batch.commit()

    records = _all_records(db, chama_id, pot_id)
    queue = pot["queue"]
    if pot.get("autoDemoteLate", True):
        queue = sorted(queue, key=lambda m: mgr_engine.late_score(records, m))

    round_complete = pot["period"] % pot["periodsPerRound"] == 0
    result = {"ok": True, "roundComplete": round_complete}

    if round_complete:
        info = mgr_engine.pool_for_round(pot, records)
        recipients = queue[: pot["recipientsPerRound"]]
        share = round((info["expected"] / len(recipients)) * 100) / 100 if recipients else 0
        pot_ref.update({"queue": queue, "updatedAt": ts})
        result.update({
            "payoutPending": True,
            "recipients": recipients,
            "shareEach": share,
            "poolExpected": info["expected"],
            "poolShortfall": info["shortfall"],
        })
    else:
        pot_ref.update({"queue": queue, "period": pot["period"] + 1, "updatedAt": ts})
        result["nextPeriod"] = pot["period"] + 1

    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def recordMgrPayoutCash(req: https_fn.CallableRequest) -> dict:
    """
    Pays out the current round's recipients (the front of the queue) in
    cash, once closeMgrPeriod has reported roundComplete=true. Advances the
    period and removes the paid recipients from the queue; marks the pot
    'completed' if fewer members remain than a round needs.
    """
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    if not chama_id or not pot_id:
        raise bad_request("chamaId and potId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    records = _all_records(db, chama_id, pot_id)
    info = mgr_engine.pool_for_round(pot, records)
    recipients = pot["queue"][: pot["recipientsPerRound"]]
    if not recipients:
        raise precondition("No recipients left in the queue for this pot.")

    share = round((info["expected"] / len(recipients)) * 100) / 100
    round_no = -(-pot["period"] // pot["periodsPerRound"])  # ceil division
    ts = now_ms()
    today = today_iso()

    batch = db.batch()
    for member_id in recipients:
        payout_ref = db.collection(paths.mgr_payouts(chama_id, pot_id)).document()
        batch.set(payout_ref, {
            "memberId": member_id,
            "round": round_no,
            "amount": share,
            "date": today,
            "method": "manual",
            "createdAt": ts,
        })
        txn_ref = db.collection(paths.transactions(chama_id)).document()
        batch.set(txn_ref, {
            "type": "mgr_payout",
            "memberId": member_id,
            "amount": share,
            "method": "manual",
            "ref": "CASH" + str(ts)[-8:] + member_id[-3:],
            "date": today,
            "settled": True,
            "direction": "out",
            "channel": "app",
            "note": pot["name"] + " payout",
            "createdAt": ts,
        })

    new_queue = [m for m in pot["queue"] if m not in recipients]
    new_status = "completed" if len(new_queue) < pot["recipientsPerRound"] else pot["status"]
    batch.update(pot_ref, {
        "queue": new_queue,
        "period": pot["period"] + 1,
        "status": new_status,
        "updatedAt": ts,
    })
    batch.commit()

    result = {"ok": True, "paidTo": recipients, "amountEach": share}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result
