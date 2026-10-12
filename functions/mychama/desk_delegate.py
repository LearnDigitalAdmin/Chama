"""
deskdelegate — the ONE private HTTPS function through which desk runs MyChama actions (W2-A).

Desk calls it with a Google ID token after its own session checks (DelegateRequest / DelegateResponse in desk's
contract.ts). Access is one-way: MyChama never calls desk, and nothing here gives desk's side a credential.
The function is deployed PRIVATE (`invoker="private"`); the only invoker is desk's runtime service account
(`roles/run.invoker`, see the hand-over notes). Unauthenticated callers are refused by Cloud Run before any code runs.

This module owns no business rules. Every action calls the code the app itself uses:
  member limits / field rules  -> mychama.identity   (ensure_member_capacity, member_field_errors, stage_member)
  SMS credits, content, segments, HostPinnacle -> mychama.sms   (plan_campaign, send_campaign)
  report credits and rendering -> mychama.reports    (generate_report_core, the shared reports engine)

Response conventions (desk reads the JSON body whatever the status, and treats HTTP 401/403 as "access refused"):
  HTTP 200 + {"ok": true, "result": ...}                    success
  HTTP 200 + {"ok": false, "error": {code, message}}        a business/authorisation refusal (message is user-readable)
  HTTP 400 / 405 + {"ok": false, ...}                       malformed request / non-POST
  HTTP 500 + {"ok": false, ...}                             unexpected failure (nothing is applied twice: see idempotency)

Idempotency: every effectful action is keyed by `requestId` in chamas/{id}/deskDelegateLog/{requestId}. A repeated
requestId returns the original response and repeats NO effect; the same requestId with a different action/agent is
refused. A failed first attempt releases the key so the caller can retry. Every action leaves an audit row in
chamas/{id}/deskAudit (what was done, by which desk, outcome — never message bodies or ID numbers).
"""

from __future__ import annotations

import csv
import io
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from firebase_admin import firestore
from firebase_functions import https_fn
from google.api_core import exceptions as gexc

from mychama import identity, reports, sms
from shared import firestore_paths as paths
from shared import reports_engine as engine
from shared.constants import PLANS
from shared.dates import now_ms
from shared.desk_codes import TOP_DESK_CODE, normalize_agent_code, normalize_public_code, resolve_chama_id
from shared.errors import bad_request, precondition
from shared.phone import normalize_phone
from shared.secrets import HP_APIKEY, HP_PASSWORD, HP_SENDER_ID, HP_USERID, ID_PEPPER

REGION = "africa-south1"

ACTIONS = ("entity_info", "validate_records", "commit_records", "schedule_sms", "send_sms_now", "run_report", "export_data")
EFFECTFUL = ("commit_records", "schedule_sms", "send_sms_now", "run_report", "export_data")
AUDIENCES = ("all", "overdue", "custom", "loan_holders", "admins")
REPORT_TYPES_FOR_DESK = reports.NEW_REPORT_TYPES            # the four engine reports; statements/minutes stay in-app
EXPORT_KINDS = ("members",)
PENDING_STALE_MS = 10 * 60 * 1000                         # > the 300 s function timeout
FILE_TTL = timedelta(minutes=15)                            # download links expire in <= 15 minutes
MAX_ROWS = 1000
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_.:\-]{8,128}$")
_EAT = timezone(timedelta(hours=3))


class DelegateRefusal(Exception):
    """A business refusal with a user-readable message; becomes {"ok": false, "error": {code, message}} at HTTP 200."""

    def __init__(self, code: str, message: str, http: int = 200):
        super().__init__(message)
        self.code, self.message, self.http = code, message, http


def _db():
    return firestore.client()


def _refusal_from_https_error(e: https_fn.HttpsError) -> DelegateRefusal:
    code = getattr(e.code, "value", str(e.code)).replace("-", "_")
    return DelegateRefusal(code, e.message)


# ------------------------------------------------------------------ request parsing / authorisation

def parse_request(body: Any) -> dict:
    if not isinstance(body, dict):
        raise DelegateRefusal("invalid_request", "The request body must be a JSON object.", 400)
    action = body.get("action")
    if action not in ACTIONS:
        raise DelegateRefusal("invalid_request", f"Unknown action. Supported: {', '.join(ACTIONS)}.", 400)
    entity = normalize_public_code(body.get("entityCode"))
    if entity is None:
        raise DelegateRefusal("invalid_request", "entityCode must be a chama code like SMC-0042.", 400)
    agent = normalize_agent_code(body.get("agentCode"))
    if agent is None:
        raise DelegateRefusal("invalid_request", "agentCode must be a desk code like COG-0007.", 400)
    rid = body.get("requestId")
    if not isinstance(rid, str) or not _REQUEST_ID_RE.match(rid):
        raise DelegateRefusal("invalid_request", "requestId must be 8-128 characters (letters, digits, - _ . :).", 400)
    payload = body.get("payload", {})
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise DelegateRefusal("invalid_request", "payload must be an object.", 400)
    return {"action": action, "entityCode": entity, "agentCode": agent, "requestId": rid, "payload": payload}


def authorise(chama: dict, agent_code: str) -> None:
    """Defence in depth on top of desk's own checks: the agent must be a connected desk, or the top desk."""
    if agent_code == TOP_DESK_CODE:
        return
    agents = chama.get("supportAgents") or {}
    if not isinstance(agents, dict) or agent_code not in agents:
        raise DelegateRefusal("not_authorised", "This chama has not connected your desk. Ask the treasurer to add your code under Settings → Support agents.")


# ------------------------------------------------------------------ idempotency + audit

def _log_ref(db, chama_id: str, request_id: str):
    return db.document(f"{paths.chama(chama_id)}/deskDelegateLog/{request_id}")


def reserve(db, chama_id: str, req: dict) -> dict | None:
    """Returns the stored response of an already-completed identical request, or None after reserving the key."""
    ref = _log_ref(db, chama_id, req["requestId"])

    @firestore.transactional
    def _txn(transaction: firestore.Transaction) -> dict | None:
        snap = ref.get(transaction=transaction)
        if snap.exists:
            x = snap.to_dict() or {}
            if x.get("action") != req["action"] or x.get("agentCode") != req["agentCode"]:
                raise DelegateRefusal("request_id_reused", "This requestId was already used for a different request.")
            if x.get("status") == "done":
                return x.get("response")
            if now_ms() - int(x.get("createdAt", 0)) < PENDING_STALE_MS:
                raise DelegateRefusal("in_progress", "This request is already being processed. Please wait a moment.", 200)
            # A pending key older than the function timeout belongs to a crashed attempt: take it over.
        transaction.set(ref, {"action": req["action"], "agentCode": req["agentCode"], "status": "pending", "createdAt": now_ms()})
        return None

    return _txn(db.transaction())


def complete(db, chama_id: str, req: dict, response: dict) -> None:
    _log_ref(db, chama_id, req["requestId"]).set({
        "action": req["action"], "agentCode": req["agentCode"], "status": "done", "response": response, "completedAt": now_ms(),
    })


def release(db, chama_id: str, req: dict) -> None:
    try:
        _log_ref(db, chama_id, req["requestId"]).delete()
    except Exception:  # noqa: BLE001
        logging.exception("deskdelegate: could not release requestId %s", req["requestId"])


def audit(db, chama_id: str, req: dict, ok: bool, summary: str, error_code: str | None = None) -> None:
    try:
        db.collection(f"{paths.chama(chama_id)}/deskAudit").document().set({
            "action": req["action"], "agentCode": req["agentCode"], "requestId": req["requestId"],
            "ok": ok, "summary": summary, "errorCode": error_code, "createdAt": now_ms(),
        })
    except Exception:  # noqa: BLE001 — an audit failure must be loud in logs; it must not undo a completed effect
        logging.exception("deskdelegate: AUDIT WRITE FAILED chama=%s request=%s", chama_id, req["requestId"])


# ------------------------------------------------------------------ actions

def _admin_of(db, chama_id: str) -> dict:
    chairs = list(db.collection(paths.members(chama_id)).where("role", "==", "chair").where("status", "==", "active").limit(1).stream())
    return chairs[0].to_dict() or {} if chairs else {}


def act_entity_info(db, chama_id: str, chama: dict, req: dict) -> dict:
    plan = chama.get("plan", "free")
    plan_cfg = PLANS.get(plan, PLANS["free"])
    admin = _admin_of(db, chama_id)
    return {
        "displayName": chama.get("name", ""),
        "adminName": admin.get("name", ""),
        "adminPhone": admin.get("phoneNormalized") or admin.get("phone", ""),
        "agentAuthorised": True,
        "plan": plan_cfg["name"],
        "creditsBalance": chama.get("smsCredits", 0),
        "audiences": list(AUDIENCES),
        "reportTypes": list(REPORT_TYPES_FOR_DESK),
        "exportKinds": list(EXPORT_KINDS) if plan_cfg["exportsAllowed"] else [],
        "memberLimit": plan_cfg["memberLimit"],
    }


def _row_value(row: dict, *names: str) -> Any:
    for n in names:
        if n in row and row[n] not in (None, ""):
            return row[n]
    return None


def _as_text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def validate_rows(db, chama_id: str, chama: dict, rows: Any) -> tuple[list[dict], list[dict]]:
    """
    Member import validation: the app's own field rules (identity.member_field_errors), duplicate phones and
    duplicate ID numbers inside the file and against existing members (removed members don't hold their ID),
    and the plan's member limit. Returns (valid_rows, errors).
    """
    if not isinstance(rows, list) or not rows:
        raise bad_request("rows must be a non-empty list.")
    if len(rows) > MAX_ROWS:
        raise bad_request(f"At most {MAX_ROWS} rows per request.")
    existing: set = set()
    existing_id_keys: set[str] = set()
    for d in db.collection(paths.members(chama_id)).stream():
        m = d.to_dict() or {}
        existing.add(m.get("phoneNormalized"))
        if m.get("status") != "removed":
            held = m.get("idKey") or identity.try_id_key(m.get("idNumber") or "")
            if held:
                existing_id_keys.add(held)
    seen: set[str] = set()
    seen_id_keys: set[str] = set()
    valid: list[dict] = []
    errors: list[dict] = []
    for i, raw in enumerate(rows, start=1):
        if not isinstance(raw, dict):
            errors.append({"row": i, "field": "row", "reason": "Each row must be an object."})
            continue
        name = _as_text(_row_value(raw, "name", "Name"))
        phone = _as_text(_row_value(raw, "phone", "Phone"))
        id_number = _as_text(_row_value(raw, "idNumber", "id_number", "ID", "id"))
        field_errors = identity.member_field_errors(name, phone, id_number)
        if field_errors:
            errors.extend({"row": i, "field": f, "reason": r} for f, r in field_errors)
            continue
        norm = normalize_phone(phone)
        if norm in existing:
            errors.append({"row": i, "field": "phone", "reason": "This phone number is already a member of this chama."})
            continue
        if norm in seen:
            errors.append({"row": i, "field": "phone", "reason": "This phone number appears more than once in the file."})
            continue
        id_key = identity.id_key_for(id_number)
        if id_key in existing_id_keys:
            errors.append({"row": i, "field": "idNumber", "reason": identity.DUPLICATE_ID_MESSAGE})
            continue
        if id_key in seen_id_keys:
            errors.append({"row": i, "field": "idNumber", "reason": "This ID number appears more than once in the file."})
            continue
        seen.add(norm)
        seen_id_keys.add(id_key)
        valid.append({"name": name, "phone": phone, "idNumber": id_number})
    plan = chama.get("plan", "free")
    limit = PLANS.get(plan, PLANS["free"])["memberLimit"]
    active = sum(1 for d in db.collection(paths.members(chama_id)).where("status", "==", "active").stream())
    room = max(0, limit - active)
    if len(valid) > room:
        for extra in valid[room:]:
            errors.append({"row": 0, "field": "plan", "reason": (
                f"The {PLANS.get(plan, PLANS['free'])['name']} plan allows {limit} active members and {active} are already in. "
                f"{extra['name']} cannot be added until the plan is upgraded.")})
        valid = valid[:room]
    return valid, errors


def act_validate_records(db, chama_id: str, chama: dict, req: dict) -> dict:
    valid, errors = validate_rows(db, chama_id, chama, req["payload"].get("rows"))
    return {"valid": valid, "errors": errors}


def act_commit_records(db, chama_id: str, chama: dict, req: dict) -> dict:
    source = req["payload"].get("source")
    if source not in ("excel", "manual"):
        raise bad_request("source must be 'excel' or 'manual'.")
    rows = req["payload"].get("rows")
    valid, errors = validate_rows(db, chama_id, chama, rows)
    if not valid:
        return {"created": 0, "skipped": len(rows), "errors": errors}
    identity.ensure_member_capacity(db, chama_id, chama.get("plan", "free"), adding=len(valid))
    created_by = f"desk:{req['agentCode']}"
    created = 0
    for start in range(0, len(valid), 160):          # 3 documents per member (member, invite, ID lock), 500 writes per batch
        chunk = valid[start:start + 160]
        batch = db.batch()
        for r in chunk:
            identity.stage_member(db, batch, chama_id, role="member", name=r["name"], phone=r["phone"],
                                  id_number=r["idNumber"], created_by=created_by)
        try:
            batch.commit()
        except gexc.AlreadyExists:
            # Someone registered one of these ID numbers after validation: the whole batch is refused, nothing
            # from it is written. Report it and stop; the caller can validate again and resend the rest.
            errors.append({"row": 0, "field": "idNumber", "reason": (
                "An ID number in this batch was registered while the import ran, so the batch was not saved. "
                "Validate again and resend the remaining rows.")})
            break
        created += len(chunk)
    return {"created": created, "skipped": len(rows) - created, "errors": errors}


def _parse_first_run(at: Any, now: int) -> int:
    if not isinstance(at, str) or not at.strip():
        raise bad_request("schedule.at must be a date and time, e.g. 2026-11-01T09:00.")
    try:
        dt = datetime.fromisoformat(at.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise bad_request("schedule.at must be a date and time, e.g. 2026-11-01T09:00.") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_EAT)                 # Kenyan local time unless an offset is given
    ms = int(dt.timestamp() * 1000)
    if ms <= now:
        raise bad_request("schedule.at must be in the future.")
    return ms


def act_schedule_sms(db, chama_id: str, chama: dict, req: dict) -> dict:
    p = req["payload"]
    message = _as_text(p.get("message"))
    audience = p.get("audience")
    sched = p.get("schedule") or {}
    if audience not in AUDIENCES:
        raise bad_request(f"audience must be one of: {', '.join(AUDIENCES)}.")
    kind = sched.get("kind")
    if kind == "once":
        raise precondition("MyChama schedules repeat daily, weekly or monthly. For a one-off message use an immediate send.")
    if kind not in ("daily", "weekly", "monthly"):
        raise bad_request("schedule.kind must be daily, weekly or monthly.")
    if sched.get("days"):
        raise precondition("MyChama schedules run at the chosen time every day, week or month; specific weekdays are not supported.")
    first_run = _parse_first_run(sched.get("at"), now_ms())
    plan = sms.plan_campaign(db, chama_id, chama, audience, message, p.get("memberIds"))
    if not plan["recipients"]:
        raise precondition("Nobody in this audience can receive an SMS (no phone number or opted out).")
    ref = db.collection(paths.sms_schedules(chama_id)).document()
    ref.set({
        "status": "active", "body": message, "audience": audience,
        "memberIds": p.get("memberIds") if audience == "custom" else None,
        "frequency": kind, "nextRun": first_run, "name": _as_text(p.get("name"))[:80] or None,
        "createdBy": f"desk:{req['agentCode']}", "createdAt": now_ms(),
    })
    return {"scheduleId": ref.id, "recipients": len(plan["recipients"]), "creditsPerRun": plan["cost"]}


def act_send_sms_now(db, chama_id: str, chama: dict, req: dict) -> dict:
    p = req["payload"]
    audience = p.get("audience")
    message = _as_text(p.get("message"))
    if audience not in AUDIENCES or not message:
        raise bad_request("audience and message are required.")
    out = sms.send_campaign(db, chama_id, chama, audience, message, p.get("memberIds"),
                            sent_by=f"desk:{req['agentCode']}", dry_run=bool(p.get("dryRun")))
    if p.get("dryRun"):
        return {"queued": out["recipients"], "creditsUsed": out.get("wouldUse", 0), "creditsRemaining": out["creditsRemaining"]}
    return {"queued": out["sent"], "creditsUsed": out["creditsUsed"], "creditsRemaining": out["creditsRemaining"]}


def act_run_report(db, chama_id: str, chama: dict, req: dict) -> dict:
    report_type = req["payload"].get("reportType")
    params = req["payload"].get("params") or {}
    if report_type not in REPORT_TYPES_FOR_DESK:
        raise bad_request(f"reportType must be one of: {', '.join(REPORT_TYPES_FOR_DESK)}.")
    if not isinstance(params, dict):
        raise bad_request("params must be an object.")
    fmt = params.get("format", "pdf")
    if fmt not in ("pdf", "csv"):
        raise bad_request("format must be 'pdf' or 'csv'.")
    out = reports.generate_report_core(
        db, chama_id, report_type=report_type, fmt=fmt, period_preset=params.get("period"), date_from=params.get("from"),
        date_to=params.get("to"), as_of=params.get("asOf"), encrypt_requested=params.get("encrypt"),
        alacarte_reference=params.get("alacarteReference"), url_ttl=FILE_TTL,
    )
    return {"downloadUrl": out["url"], "expiresAt": now_ms() + int(FILE_TTL.total_seconds() * 1000)}


def act_export_data(db, chama_id: str, chama: dict, req: dict) -> dict:
    kind = req["payload"].get("kind")
    if kind not in EXPORT_KINDS:
        raise bad_request(f"kind must be one of: {', '.join(EXPORT_KINDS)}.")
    plan_cfg = PLANS.get(chama.get("plan", "free"), PLANS["free"])
    if not plan_cfg["exportsAllowed"]:
        raise precondition(f"Exports aren't available on the {plan_cfg['name']} plan — upgrade to export data.")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Phone", "Role", "Status", "Joined"])
    for d in db.collection(paths.members(chama_id)).stream():           # no ID numbers leave the system
        m = d.to_dict() or {}
        w.writerow([m.get("name", ""), m.get("phoneNormalized") or m.get("phone", ""), m.get("role", ""), m.get("status", ""), m.get("joinDate", "")])
    url = engine.upload_and_sign(chama_id, f"export-members-{chama_id}-{now_ms()}.csv", buf.getvalue().encode("utf-8"), "text/csv", FILE_TTL)
    return {"downloadUrl": url, "expiresAt": now_ms() + int(FILE_TTL.total_seconds() * 1000)}


HANDLERS: dict[str, Callable[[Any, str, dict, dict], dict]] = {
    "entity_info": act_entity_info,
    "validate_records": act_validate_records,
    "commit_records": act_commit_records,
    "schedule_sms": act_schedule_sms,
    "send_sms_now": act_send_sms_now,
    "run_report": act_run_report,
    "export_data": act_export_data,
}


def _summary(req: dict, result: dict | None) -> str:
    a = req["action"]
    r = result or {}
    if a == "commit_records":
        return f"created {r.get('created', 0)}, skipped {r.get('skipped', 0)}"
    if a == "send_sms_now":
        return ("quote " if req["payload"].get("dryRun") else "sent ") + f"{r.get('queued', 0)} recipients, {r.get('creditsUsed', 0)} credits"
    if a == "schedule_sms":
        return f"schedule {r.get('scheduleId', '')}, {r.get('recipients', 0)} recipients"
    if a == "run_report":
        return f"report {req['payload'].get('reportType')}"
    if a == "export_data":
        return f"export {req['payload'].get('kind')}"
    return a


def handle(db, body: Any) -> tuple[int, dict]:
    """Whole request -> (HTTP status, DelegateResponse). Pure of Flask so it is unit-testable."""
    try:
        req = parse_request(body)
    except DelegateRefusal as e:
        return e.http, {"ok": False, "error": {"code": e.code, "message": e.message}}

    chama_id = resolve_chama_id(db, req["entityCode"])
    if chama_id is None:
        return 200, {"ok": False, "error": {"code": "entity_not_found", "message": "No chama has that code."}}
    chama = (db.document(paths.chama(chama_id)).get().to_dict()) or {}

    reserved = False
    try:
        authorise(chama, req["agentCode"])
        quote = req["action"] == "send_sms_now" and bool(req["payload"].get("dryRun"))
        if req["action"] in EFFECTFUL and not quote:
            replay = reserve(db, chama_id, req)
            if replay is not None:
                return 200, replay
            reserved = True
        result = HANDLERS[req["action"]](db, chama_id, chama, req)
        response = {"ok": True, "result": result}
        if reserved:
            complete(db, chama_id, req, response)
        audit(db, chama_id, req, True, _summary(req, result))
        return 200, response
    except https_fn.HttpsError as e:
        refusal = _refusal_from_https_error(e)
    except DelegateRefusal as e:
        refusal = e
    except Exception:  # noqa: BLE001
        logging.exception("deskdelegate: unexpected failure action=%s chama=%s", req["action"], chama_id)
        if reserved:
            release(db, chama_id, req)
        audit(db, chama_id, req, False, req["action"], "internal")
        return 500, {"ok": False, "error": {"code": "internal", "message": "Something went wrong on MyChama's side. Please try again."}}

    if reserved:
        release(db, chama_id, req)   # nothing was applied: let the caller retry with the same requestId
    audit(db, chama_id, req, False, req["action"], refusal.code)
    return refusal.http, {"ok": False, "error": {"code": refusal.code, "message": refusal.message}}


@https_fn.on_request(region=REGION, invoker="private", secrets=[HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID, ID_PEPPER], timeout_sec=300, memory=512)
def deskdelegate(request) -> Any:
    """POST only. Private: Cloud Run IAM admits only desk's service account."""
    from flask import jsonify

    if request.method != "POST":
        r = jsonify({"ok": False, "error": {"code": "method_not_allowed", "message": "POST only."}})
        r.status_code = 405
        r.headers["Allow"] = "POST"
        return r
    if not (request.headers.get("Authorization") or "").startswith("Bearer "):
        r = jsonify({"ok": False, "error": {"code": "unauthenticated", "message": "Missing credentials."}})
        r.status_code = 401
        return r
    status, payload = handle(_db(), request.get_json(silent=True))
    r = jsonify(payload)
    r.status_code = status
    return r
