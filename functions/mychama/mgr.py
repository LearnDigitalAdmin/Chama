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

--------------------------------------------------------------------------
MGR REPAIR — feature-parity pass with the original demo (see TOUCH_BASE.md
"MGR repair"). Everything below is new. All of it follows the same trust
split as the four callables above:
  - mgrAddMembers / mgrRemoveMember / mgrReorderQueue — membership &
    ordering changes. Reordering is deliberately still a callable even
    though firestore.rules lets a finance admin write `queue` directly on
    the pot doc — this validates the new order is a permutation of the
    CURRENT queue (can't inject a member who isn't in it) and logs the
    change to the ledger, so a bad client-side drag never corrupts payout
    order silently.
  - mgrProposeExit / mgrSettleExit — a member leaving mid-cycle. Propose
    computes (server-side, from records+payouts) what the pot owes them or
    they owe the pot; settle records how the cash actually moved and
    removes them from the pot.
  - mgrSettleArrear / mgrWriteOffArrear — arrears are opened automatically
    by closeMgrPeriod (one running-balance doc per member per pot); these
    close them out.
  - mgrCoverShortfall — records how a round's shortfall (promised payout
    minus what was actually collected) got made up, and clears it from
    pot.pendingShortfall. recordMgrPayoutCash refuses to pay out while a
    shortfall is outstanding unless the caller explicitly acknowledges it.
  - mgrRepairPot — the only callable that MUTATES based on
    mgr_engine.health_check's findings (de-dupes/reconciles the queue).
    The health check itself is pure and mirrored client-side
    (src/lib/mgrEngine.ts::healthCheck) for an instant-feeling Health card
    — reading it needs no round trip, acting on it always does.
  - mgrCloseForever — retires a pot. Refuses while arrears are open or a
    shortfall is outstanding, to stop a pot being closed with unresolved
    money still on the table.

Every mutation below writes an entry to the pot's own `ledger`
subcollection (functions/shared/types.py::MgrLedgerEntry) — independent of
the chama-wide `transactions` collection — so a single pot's full history
can be audited or exported without cross-referencing anything else.
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


def _all_payouts(db, chama_id: str, pot_id: str) -> list[dict]:
    return [d.to_dict() | {"id": d.id} for d in db.collection(paths.mgr_payouts(chama_id, pot_id)).stream()]


def _all_arrears(db, chama_id: str, pot_id: str) -> list[dict]:
    return [d.to_dict() | {"id": d.id} for d in db.collection(paths.mgr_arrears(chama_id, pot_id)).stream()]


def _open_arrear_for(db, chama_id: str, pot_id: str, member_id: str):
    q = (
        db.collection(paths.mgr_arrears(chama_id, pot_id))
        .where("memberId", "==", member_id)
        .where("status", "==", "open")
        .limit(1)
        .stream()
    )
    docs = list(q)
    return docs[0] if docs else None


def _log(db, chama_id: str, pot_id: str, kind: str, *, member_id: str | None = None, amount: float | None = None, note: str | None = None) -> None:
    entry = {"kind": kind, "createdAt": now_ms()}
    if member_id is not None:
        entry["memberId"] = member_id
    if amount is not None:
        entry["amount"] = amount
    if note is not None:
        entry["note"] = note
    db.collection(paths.mgr_ledger(chama_id, pot_id)).document().set(entry)


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
        "potId": pot_id,
        "createdAt": ts,
    })
    _log(db, chama_id, pot_id, "contribution", member_id=member_id, amount=use_amount, note="cash")

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

    # Anyone with no record for this period is marked missed, and gets (or
    # tops up) an open arrears balance — this is what turns a bare "missed"
    # flag into a chaseable running total instead of a fact that's only
    # ever visible one period at a time.
    have_records = {
        d.to_dict()["memberId"]
        for d in db.collection(paths.mgr_records(chama_id, pot_id)).where("period", "==", pot["period"]).stream()
    }
    missed_ids = [m for m in pot["memberIds"] if m not in have_records]
    batch = db.batch()
    for member_id in missed_ids:
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
        existing_arrear = _open_arrear_for(db, chama_id, pot_id, member_id)
        if existing_arrear:
            a = existing_arrear.to_dict()
            batch.update(existing_arrear.reference, {
                "amount": round((a["amount"] + pot["amount"]) * 100) / 100,
                "periods": a.get("periods", []) + [pot["period"]],
                "updatedAt": ts,
            })
        else:
            arrear_ref = db.collection(paths.mgr_arrears(chama_id, pot_id)).document()
            batch.set(arrear_ref, {
                "memberId": member_id,
                "periods": [pot["period"]],
                "amount": pot["amount"],
                "status": "open",
                "createdAt": ts,
                "updatedAt": ts,
            })
    batch.commit()
    for member_id in missed_ids:
        _log(db, chama_id, pot_id, "arrear_opened", member_id=member_id, amount=pot["amount"], note=f"period {pot['period']}")

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
        pot_ref.update({"queue": queue, "pendingShortfall": info["shortfall"], "updatedAt": ts})
        if info["shortfall"] > 0:
            _log(db, chama_id, pot_id, "shortfall_recorded", amount=info["shortfall"], note=f"round ending period {pot['period']}")
        _log(db, chama_id, pot_id, "period_closed", note=f"period {pot['period']} (round complete)")
        result.update({
            "payoutPending": True,
            "recipients": recipients,
            "shareEach": share,
            "poolExpected": info["expected"],
            "poolShortfall": info["shortfall"],
        })
    else:
        pot_ref.update({"queue": queue, "period": pot["period"] + 1, "updatedAt": ts})
        _log(db, chama_id, pot_id, "period_closed", note=f"period {pot['period']}")
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

    if pot.get("pendingShortfall", 0) > 0 and not data.get("acknowledgeShortfall"):
        raise precondition(
            f"This round is short by KES {pot['pendingShortfall']:,.2f} — record how it's being covered "
            "(mgrCoverShortfall) first, or pay out anyway with acknowledgeShortfall."
        )

    records = _all_records(db, chama_id, pot_id)
    short_round = mgr_engine.is_short_round(pot)
    plan = mgr_engine.build_final_plan(pot, records) if short_round else None
    info = mgr_engine.pool_for_round(pot, records)
    recipients = plan["recipients"] if plan else pot["queue"][: pot["recipientsPerRound"]]
    if not recipients:
        raise precondition("No recipients left in the queue for this pot.")

    share = plan["shareEach"] if plan else round((info["expected"] / len(recipients)) * 100) / 100
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
            "note": pot["name"] + " payout" + (" (final, short round)" if short_round else ""),
            "potId": pot_id,
            "createdAt": ts,
        })

    new_queue = [m for m in pot["queue"] if m not in recipients]
    new_status = "completed" if short_round or len(new_queue) < pot["recipientsPerRound"] else pot["status"]
    batch.update(pot_ref, {
        "queue": new_queue,
        "period": pot["period"] + 1,
        "status": new_status,
        "pendingShortfall": 0,
        "updatedAt": ts,
    })
    batch.commit()
    for member_id in recipients:
        _log(db, chama_id, pot_id, "payout", member_id=member_id, amount=share, note=f"round {round_no}")

    result = {"ok": True, "paidTo": recipients, "amountEach": share}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


# --------------------------------------------------------------------- #
# Membership & queue
# --------------------------------------------------------------------- #

@https_fn.on_call(region=REGION)
def mgrAddMembers(req: https_fn.CallableRequest) -> dict:
    """Adds member(s) to a pot that's already drawn — appended to the back
    of the queue so they join the rotation without displacing anyone
    already waiting. (A draft pot's membership is edited by re-running
    createMgrPot's picker instead, so this only applies once drawDone.)"""
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    member_ids = data.get("memberIds") or []
    if not chama_id or not pot_id or not member_ids:
        raise bad_request("chamaId, potId, and memberIds are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    if pot["status"] not in ("draft", "active"):
        raise precondition("Members can only be added to a draft or active pot.")

    new_ids = [m for m in member_ids if m not in pot["memberIds"]]
    if not new_ids:
        raise bad_request("Those members are already in this pot.")

    ts = now_ms()
    pot_ref.update({
        "memberIds": pot["memberIds"] + new_ids,
        "queue": pot["queue"] + new_ids if pot["drawDone"] else pot["queue"],
        "updatedAt": ts,
    })
    for member_id in new_ids:
        _log(db, chama_id, pot_id, "member_added", member_id=member_id)

    result = {"ok": True, "added": new_ids}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def mgrRemoveMember(req: https_fn.CallableRequest) -> dict:
    """Removes a member who has NOT yet received a payout this cycle and
    has no open arrear — a plain "never got their turn, take them out"
    removal. Someone who HAS received a payout, or is owed/owes money,
    must go through mgrProposeExit/mgrSettleExit instead so that money
    is accounted for."""
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    member_id = data.get("memberId")
    if not chama_id or not pot_id or not member_id:
        raise bad_request("chamaId, potId, and memberId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    if member_id not in pot["memberIds"]:
        raise bad_request("That member isn't in this pot.")

    payouts = _all_payouts(db, chama_id, pot_id)
    if any(p["memberId"] == member_id for p in payouts):
        raise precondition("This member has already received a payout — use mgrProposeExit instead.")
    if _open_arrear_for(db, chama_id, pot_id, member_id):
        raise precondition("This member has an open arrear — settle or write it off first.")

    ts = now_ms()
    pot_ref.update({
        "memberIds": [m for m in pot["memberIds"] if m != member_id],
        "queue": [m for m in pot["queue"] if m != member_id],
        "updatedAt": ts,
    })
    _log(db, chama_id, pot_id, "member_removed", member_id=member_id)

    result = {"ok": True}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def mgrReorderQueue(req: https_fn.CallableRequest) -> dict:
    """
    Manual promotion/relegation override. The UI may compute and preview a
    proposed order client-side (src/lib/mgrEngine.ts — late score and
    recent reliability are already trusted read-only figures, so a
    same-inputs preview costs nothing to trust); this callable is what
    actually commits any reorder, so a queue can never be rewritten to
    something that isn't a permutation of who's actually in it.
    """
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    new_queue = data.get("queue")
    if not chama_id or not pot_id or not isinstance(new_queue, list):
        raise bad_request("chamaId, potId, and queue (array) are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    if sorted(new_queue) != sorted(pot["queue"]):
        raise bad_request("The new queue must contain exactly the same members as the current one, reordered.")

    pot_ref.update({"queue": new_queue, "updatedAt": now_ms()})
    _log(db, chama_id, pot_id, "queue_reordered", note=",".join(new_queue))
    return {"ok": True}


@https_fn.on_call(region=REGION)
def mgrToggleAutoDemote(req: https_fn.CallableRequest) -> dict:
    """Trivial pot-field toggle — kept as a callable (rather than a direct
    client write, though firestore.rules would allow one) so it lands in
    the same audit ledger as every other pot change."""
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    if not chama_id or not pot_id:
        raise bad_request("chamaId and potId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    new_value = not pot.get("autoDemoteLate", True)
    pot_ref.update({"autoDemoteLate": new_value, "updatedAt": now_ms()})
    _log(db, chama_id, pot_id, "repaired", note=f"autoDemoteLate -> {new_value}")
    return {"ok": True, "autoDemoteLate": new_value}


# --------------------------------------------------------------------- #
# Arrears
# --------------------------------------------------------------------- #

@https_fn.on_call(region=REGION)
def mgrSettleArrear(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    arrear_id = data.get("arrearId")
    amount = data.get("amount")
    if not chama_id or not pot_id or not arrear_id:
        raise bad_request("chamaId, potId, and arrearId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    _, pot = _get_pot(db, chama_id, pot_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    arrear_ref = db.document(paths.mgr_arrear(chama_id, pot_id, arrear_id))
    arrear_snap = arrear_ref.get()
    if not arrear_snap.exists:
        raise not_found("Arrear not found.")
    arrear = arrear_snap.to_dict()
    if arrear.get("status") != "open":
        raise precondition("This arrear is already closed.")

    pay_amount = float(amount) if isinstance(amount, (int, float)) and amount > 0 else arrear["amount"]
    pay_amount = min(pay_amount, arrear["amount"])
    remaining = round((arrear["amount"] - pay_amount) * 100) / 100
    ts = now_ms()
    today = today_iso()

    arrear_ref.update({
        "amount": remaining,
        "status": "settled" if remaining <= 0 else "open",
        "settledAmount": arrear.get("settledAmount", 0) + pay_amount,
        "updatedAt": ts,
    })
    db.collection(paths.transactions(chama_id)).document().set({
        "type": "mgr_contribution",
        "memberId": arrear["memberId"],
        "amount": pay_amount,
        "method": "manual",
        "ref": "CASH" + str(ts)[-8:],
        "date": today,
        "settled": False,
        "direction": "in",
        "channel": "app",
        "note": pot["name"] + " arrear settlement",
        "potId": pot_id,
        "createdAt": ts,
    })
    _log(db, chama_id, pot_id, "arrear_settled", member_id=arrear["memberId"], amount=pay_amount)

    result = {"ok": True, "remaining": remaining}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def mgrWriteOffArrear(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    arrear_id = data.get("arrearId")
    reason = (data.get("reason") or "").strip()
    if not chama_id or not pot_id or not arrear_id or not reason:
        raise bad_request("chamaId, potId, arrearId, and a reason are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    _get_pot(db, chama_id, pot_id)

    arrear_ref = db.document(paths.mgr_arrear(chama_id, pot_id, arrear_id))
    arrear_snap = arrear_ref.get()
    if not arrear_snap.exists:
        raise not_found("Arrear not found.")
    arrear = arrear_snap.to_dict()
    if arrear.get("status") != "open":
        raise precondition("This arrear is already closed.")

    arrear_ref.update({"status": "written_off", "writeOffReason": reason, "updatedAt": now_ms()})
    _log(db, chama_id, pot_id, "arrear_written_off", member_id=arrear["memberId"], amount=arrear["amount"], note=reason)
    return {"ok": True}


# --------------------------------------------------------------------- #
# Shortfall
# --------------------------------------------------------------------- #

@https_fn.on_call(region=REGION)
def mgrCoverShortfall(req: https_fn.CallableRequest) -> dict:
    """Records how a completed round's shortfall (promised payout minus
    what was actually collected — see mgr_engine.pool_for_round) is being
    made up: cash injected from the chama's own reserve, or a specific
    member topping up. Clears pot.pendingShortfall so recordMgrPayoutCash
    stops refusing to pay out."""
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    amount = data.get("amount")
    source = data.get("source")  # 'reserve' | 'member'
    member_id = data.get("memberId")
    if not chama_id or not pot_id or source not in ("reserve", "member"):
        raise bad_request("chamaId, potId, and source ('reserve' or 'member') are required.")
    if source == "member" and not member_id:
        raise bad_request("memberId is required when source is 'member'.")
    if not isinstance(amount, (int, float)) or amount <= 0:
        raise bad_request("amount must be a positive number.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    current = pot.get("pendingShortfall", 0)
    if current <= 0:
        raise precondition("This pot has no outstanding shortfall.")

    covered = min(float(amount), current)
    remaining = round((current - covered) * 100) / 100
    ts = now_ms()
    today = today_iso()

    pot_ref.update({"pendingShortfall": remaining, "updatedAt": ts})
    db.collection(paths.transactions(chama_id)).document().set({
        "type": "mgr_contribution",
        "memberId": member_id or "chama_reserve",
        "amount": covered,
        "method": "manual",
        "ref": "CASH" + str(ts)[-8:],
        "date": today,
        "settled": False,
        "direction": "in",
        "channel": "app",
        "note": pot["name"] + " shortfall cover (" + source + ")",
        "potId": pot_id,
        "createdAt": ts,
    })
    _log(db, chama_id, pot_id, "shortfall_covered", member_id=member_id, amount=covered, note=source)

    result = {"ok": True, "remaining": remaining}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


# --------------------------------------------------------------------- #
# Exits
# --------------------------------------------------------------------- #

@https_fn.on_call(region=REGION)
def mgrProposeExit(req: https_fn.CallableRequest) -> dict:
    """Computes what a member leaving mid-cycle is owed, or owes: their
    paid-in total this cycle (records with status 'paid', current
    cycleNumber) minus what they've already received in payouts. Writes a
    'proposed' exits doc for the admin to review before mgrSettleExit
    actually moves them out."""
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    member_id = data.get("memberId")
    if not chama_id or not pot_id or not member_id:
        raise bad_request("chamaId, potId, and memberId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    _, pot = _get_pot(db, chama_id, pot_id)
    if member_id not in pot["memberIds"]:
        raise bad_request("That member isn't in this pot.")

    records = _all_records(db, chama_id, pot_id)
    payouts = _all_payouts(db, chama_id, pot_id)
    paid_in = sum(r["amount"] for r in records if r["memberId"] == member_id and r["status"] == "paid")
    received = sum(p["amount"] for p in payouts if p["memberId"] == member_id)
    net = round((paid_in - received) * 100) / 100  # positive: pot owes them; negative: they owe the pot

    ts = now_ms()
    ref = db.collection(paths.mgr_exits(chama_id, pot_id)).document()
    ref.set({"memberId": member_id, "proposedNet": net, "status": "proposed", "createdAt": ts, "updatedAt": ts})
    return {"exitId": ref.id, "proposedNet": net}


@https_fn.on_call(region=REGION)
def mgrSettleExit(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    exit_id = data.get("exitId")
    settled_amount = data.get("settledAmount")
    if not chama_id or not pot_id or not exit_id:
        raise bad_request("chamaId, potId, and exitId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    exit_ref = db.document(paths.mgr_exit(chama_id, pot_id, exit_id))
    exit_snap = exit_ref.get()
    if not exit_snap.exists:
        raise not_found("Exit proposal not found.")
    exit_doc = exit_snap.to_dict()
    if exit_doc.get("status") != "proposed":
        raise precondition("This exit has already been settled.")
    if _open_arrear_for(db, chama_id, pot_id, exit_doc["memberId"]):
        raise precondition("This member has an open arrear — settle or write it off before exiting them.")

    amount = float(settled_amount) if isinstance(settled_amount, (int, float)) else abs(exit_doc["proposedNet"])
    direction = "pot_to_member" if exit_doc["proposedNet"] >= 0 else "member_to_pot"
    ts = now_ms()
    today = today_iso()
    member_id = exit_doc["memberId"]

    if amount > 0:
        db.collection(paths.transactions(chama_id)).document().set({
            "type": "mgr_payout" if direction == "pot_to_member" else "mgr_contribution",
            "memberId": member_id,
            "amount": amount,
            "method": "manual",
            "ref": "CASH" + str(ts)[-8:],
            "date": today,
            "settled": True,
            "direction": "out" if direction == "pot_to_member" else "in",
            "channel": "app",
            "note": pot["name"] + " exit settlement",
            "potId": pot_id,
            "createdAt": ts,
        })

    exit_ref.update({"status": "settled", "settledAmount": amount, "settledDirection": direction, "updatedAt": ts})
    pot_ref.update({
        "memberIds": [m for m in pot["memberIds"] if m != member_id],
        "queue": [m for m in pot["queue"] if m != member_id],
        "updatedAt": ts,
    })
    _log(db, chama_id, pot_id, "exit_settled", member_id=member_id, amount=amount, note=direction)

    result = {"ok": True, "settledAmount": amount, "settledDirection": direction}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


# --------------------------------------------------------------------- #
# Health, repair & closing
# --------------------------------------------------------------------- #

@https_fn.on_call(region=REGION)
def mgrRepairPot(req: https_fn.CallableRequest) -> dict:
    """The only callable allowed to ACT on mgr_engine.health_check's
    findings: de-dupes the queue, drops queue entries for members who are
    no longer in the pot, and appends any current member missing from an
    active pot's queue. Never touches arrears/exits/shortfall — those need
    a human decision (settle vs write off, which source covers a
    shortfall), so they're only ever surfaced, never auto-resolved."""
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    if not chama_id or not pot_id:
        raise bad_request("chamaId and potId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    member_set = set(pot["memberIds"])
    seen: set[str] = set()
    fixed_queue = []
    for m in pot["queue"]:
        if m in member_set and m not in seen:
            fixed_queue.append(m)
            seen.add(m)
    if pot["status"] == "active":
        for m in pot["memberIds"]:
            if m not in seen:
                fixed_queue.append(m)
                seen.add(m)

    changed = fixed_queue != pot["queue"]
    if changed:
        pot_ref.update({"queue": fixed_queue, "updatedAt": now_ms()})
        _log(db, chama_id, pot_id, "repaired", note=f"queue: {len(pot['queue'])} -> {len(fixed_queue)} entries")

    return {"ok": True, "changed": changed, "queue": fixed_queue}


@https_fn.on_call(region=REGION)
def mgrCloseForever(req: https_fn.CallableRequest) -> dict:
    """Retires a pot. Refuses while money is still unresolved — an open
    arrear or an uncovered shortfall — so closing a pot can't be used to
    quietly write off a balance nobody actually decided to forgive."""
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    pot_id = data.get("potId")
    if not chama_id or not pot_id:
        raise bad_request("chamaId and potId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)
    pot_ref, pot = _get_pot(db, chama_id, pot_id)

    if pot.get("pendingShortfall", 0) > 0:
        raise precondition("This pot has an uncovered shortfall — record how it's covered (mgrCoverShortfall) first.")
    open_arrears = [a for a in _all_arrears(db, chama_id, pot_id) if a.get("status") == "open"]
    if open_arrears:
        raise precondition(f"This pot has {len(open_arrears)} open arrear(s) — settle or write them off first.")

    ts = now_ms()
    pot_ref.update({"status": "closed", "closedAt": ts, "updatedAt": ts})
    _log(db, chama_id, pot_id, "pot_closed")
    return {"ok": True}
