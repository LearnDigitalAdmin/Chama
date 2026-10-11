"""
Desk support (W2-A): Support Agents and Desk requests.

Access is ONE-WAY: nothing here calls desk or holds a credential for it. A request is written into MyChama's
OWN `desk_requests` outbox (OutboxSupportItem in desk's contract.ts); desk's 30-minute sweeper pulls it and later
writes `deskStatus` / `responses` back into the same document, which listDeskRequests shows to the chama.

Support agents live on the chama document as `supportAgents.<COG-####> = {addedAt, addedBy}`. MyChama cannot
verify a code exists in desk, so any well-formed code is accepted. COG-0000 (the company's top desk) is always
connected, shown locked, and can be neither added nor removed. Customers never write these fields directly
(firestore.rules) — only the callables below.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from firebase_admin import firestore
from firebase_functions import https_fn

from shared import firestore_paths as paths
from shared.constants import MC
from shared.dates import now_ms
from shared.desk_codes import (
    MAX_DESKS_PER_CHAMA, TOP_DESK_CODE, allocate_for_existing_chama, normalize_agent_code,
)
from shared.errors import bad_request, not_found, precondition, rate_limited, require_auth
from shared.idempotency import already_applied, record_result
from shared.roles import require_finance_admin, require_official

REGION = "africa-south1"

OUTBOX_COLLECTION = "desk_requests"
REQUEST_CATEGORIES = ("setup", "import", "sms", "payments", "reports", "account", "other")
MAX_REQUESTS_PER_CHAMA_PER_DAY = 5
MAX_SUBJECT = 120
MAX_MESSAGE = 2000
LIST_LIMIT = 50
_EAT = timezone(timedelta(hours=3))  # Africa/Nairobi — a "day" for the daily limit is a Kenyan calendar day


def _db():
    return firestore.client()


def _agent_path(code: str) -> str:
    """Dotted field path with the code quoted, because a hyphen is not legal in an unquoted path segment."""
    return f"supportAgents.`{code}`"


# ------------------------------------------------------------------ pure logic (unit tested)

def connected_desks(chama: dict) -> list[str]:
    """Connected NON-top desks, oldest connection first (stable tie-break on the code)."""
    agents = chama.get("supportAgents") or {}
    if not isinstance(agents, dict):
        return []
    items = [(code, (v or {}).get("addedAt", 0) if isinstance(v, dict) else 0) for code, v in agents.items()
             if normalize_agent_code(code) and code != TOP_DESK_CODE]
    return [c for c, _ in sorted(items, key=lambda t: (t[1], t[0]))]


def route_targets(chama: dict, desk_code: str | None, also_top: bool) -> list[str]:
    """
    Where a request goes: the chosen connected desk, else the first connected non-top desk, else COG-0000.
    COG-0000 is added when the customer asked for it. Raises bad_request for a desk that is not connected.
    """
    desks = connected_desks(chama)
    if desk_code:
        code = normalize_agent_code(desk_code)
        if code is None:
            raise bad_request("That desk code is not valid.")
        if code == TOP_DESK_CODE:
            chosen = None
        elif code in desks:
            chosen = code
        else:
            raise bad_request("That desk is not connected to this chama. Add it under Settings → Support agents first.")
    else:
        chosen = desks[0] if desks else None
    targets = [chosen] if chosen else [TOP_DESK_CODE]
    if also_top and TOP_DESK_CODE not in targets:
        targets.append(TOP_DESK_CODE)
    return targets


def validate_request_fields(category: Any, subject: Any, message: Any) -> tuple[str, str, str]:
    if category not in REQUEST_CATEGORIES:
        raise bad_request(f"category must be one of: {', '.join(REQUEST_CATEGORIES)}.")
    sub = (subject or "").strip() if isinstance(subject, str) else ""
    msg = (message or "").strip() if isinstance(message, str) else ""
    if not sub or len(sub) > MAX_SUBJECT:
        raise bad_request(f"Subject is required and must be at most {MAX_SUBJECT} characters.")
    if not msg or len(msg) > MAX_MESSAGE:
        raise bad_request(f"Message is required and must be at most {MAX_MESSAGE} characters.")
    return category, sub, msg


def day_key(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, _EAT).strftime("%Y-%m-%d")


# ------------------------------------------------------------------ Support Agents

def _agent_code_arg(data: dict) -> str:
    code = normalize_agent_code(data.get("agentCode"))
    if code is None:
        raise bad_request("Enter a desk code like COG-0007.")
    if code == TOP_DESK_CODE:
        raise precondition(f"{TOP_DESK_CODE} is the company desk. It is always connected and cannot be added or removed.")
    return code


@https_fn.on_call(region=REGION)
def addSupportAgent(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    if not chama_id:
        raise bad_request("chamaId is required.")
    code = _agent_code_arg(data)
    db = _db()
    caller = require_finance_admin(db, uid, chama_id)  # treasurer / chair only
    chama_ref = db.document(paths.chama(chama_id))

    @firestore.transactional
    def _txn(transaction: firestore.Transaction) -> bool:
        snap = chama_ref.get(transaction=transaction)
        if not snap.exists:
            raise not_found("Chama not found.")
        desks = connected_desks(snap.to_dict() or {})
        if code in desks:
            return False
        if len(desks) >= MAX_DESKS_PER_CHAMA:
            raise rate_limited(f"A chama can connect up to {MAX_DESKS_PER_CHAMA} desks. Remove one first.")
        ts = now_ms()
        transaction.update(chama_ref, {_agent_path(code): {"addedAt": ts, "addedBy": caller.member_id}, "updatedAt": ts})
        return True

    added = _txn(db.transaction())
    return {"ok": True, "added": added}


@https_fn.on_call(region=REGION)
def removeSupportAgent(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    if not chama_id:
        raise bad_request("chamaId is required.")
    code = _agent_code_arg(data)
    db = _db()
    require_finance_admin(db, uid, chama_id)
    chama_ref = db.document(paths.chama(chama_id))
    if not chama_ref.get().exists:
        raise not_found("Chama not found.")
    chama_ref.update({_agent_path(code): firestore.DELETE_FIELD, "updatedAt": now_ms()})
    return {"ok": True}


@https_fn.on_call(region=REGION)
def listSupportAgents(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    chama_id = (req.data or {}).get("chamaId")
    if not chama_id:
        raise bad_request("chamaId is required.")
    db = _db()
    require_finance_admin(db, uid, chama_id)
    snap = db.document(paths.chama(chama_id)).get()
    if not snap.exists:
        raise not_found("Chama not found.")
    chama = snap.to_dict() or {}
    agents = chama.get("supportAgents") or {}
    rows: list[dict] = [{"agentCode": TOP_DESK_CODE, "name": "Samuhia company desk", "addedAt": 0, "locked": True}]
    for code in connected_desks(chama):
        rows.append({"agentCode": code, "name": "", "addedAt": int((agents.get(code) or {}).get("addedAt", 0)), "locked": False})
    return {"agents": rows, "maxDesks": MAX_DESKS_PER_CHAMA}


# ------------------------------------------------------------------ Desk requests

@https_fn.on_call(region=REGION)
def createDeskRequest(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    if not chama_id:
        raise bad_request("chamaId is required.")
    category, subject, message = validate_request_fields(data.get("category"), data.get("subject"), data.get("message"))
    also_top = bool(data.get("alsoTopDesk"))
    desk_code = data.get("deskCode") or None

    db = _db()
    caller = require_official(db, uid, chama_id)
    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    chama_ref = db.document(paths.chama(chama_id))
    chama_snap = chama_ref.get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict() or {}
    targets = route_targets(chama, desk_code, also_top)

    public_code = chama.get("publicCode") or allocate_for_existing_chama(db, chama_id)
    member_snap = db.document(paths.member(chama_id, caller.member_id)).get()
    member = member_snap.to_dict() or {} if member_snap.exists else {}

    ts = now_ms()
    limit_ref = db.document(f"{paths.chama(chama_id)}/deskRequestLimits/{day_key(ts)}")
    outbox_ref = db.collection(OUTBOX_COLLECTION).document()

    @firestore.transactional
    def _txn(transaction: firestore.Transaction) -> None:
        used = int((limit_ref.get(transaction=transaction).to_dict() or {}).get("count", 0))
        if used >= MAX_REQUESTS_PER_CHAMA_PER_DAY:
            raise rate_limited(
                f"Your chama has already sent {MAX_REQUESTS_PER_CHAMA_PER_DAY} desk requests today. Please try again tomorrow."
            )
        transaction.set(limit_ref, {"count": used + 1, "updatedAt": ts})
        transaction.set(outbox_ref, {
            # OutboxSupportItem (contract.ts)
            "kind": "support",
            "status": "new",
            "entityCode": public_code,
            "entityName": chama.get("name", ""),
            "requesterName": member.get("name", ""),
            "requesterPhone": member.get("phoneNormalized") or member.get("phone", ""),
            "category": category,
            "subject": subject,
            "message": message,
            "targetDeskCodes": targets,
            "createdAt": ts,
            # MyChama-side fields so the chama can list its own requests; desk ignores unknown fields.
            "chamaId": chama_id,
            "requestedBy": uid,
        })

    _txn(db.transaction())
    logging.info("createDeskRequest: chamaId=%s id=%s targets=%s", chama_id, outbox_ref.id, targets)
    result = {"id": outbox_ref.id, "targetDeskCodes": targets}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def listDeskRequests(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    chama_id = (req.data or {}).get("chamaId")
    if not chama_id:
        raise bad_request("chamaId is required.")
    db = _db()
    require_official(db, uid, chama_id)
    docs = (
        db.collection(OUTBOX_COLLECTION).where("chamaId", "==", chama_id)
        .order_by("createdAt", direction=firestore.Query.DESCENDING).limit(LIST_LIMIT).stream()
    )
    items: list[dict] = []
    for d in docs:
        x = d.to_dict() or {}
        items.append({
            "id": d.id,
            "category": x.get("category"),
            "subject": x.get("subject"),
            "message": x.get("message"),
            "targetDeskCodes": x.get("targetDeskCodes", []),
            "outboxStatus": x.get("status"),          # new | pulled | rejected
            "deskStatus": x.get("deskStatus"),        # written back by desk: new | open | answered | closed
            "responses": x.get("responses", []),
            "error": x.get("error"),
            "createdAt": x.get("createdAt", 0),
        })
    return {"requests": items}
