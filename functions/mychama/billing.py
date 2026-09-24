"""
Billing, reports & exports — Phase 4.

Three callables plus two scheduled sweeps:

  upgradePlan        — chair-only. Changing to a plan with price > 0 follows
                        the EXACT same pending-payment pattern as
                        purchaseSmsCredits (see functions/mychama/sms.py and
                        docs/ARCHITECTURE.md §6): a planBilling/{reference}
                        doc (prefix MCP-) is created with status 'pending'
                        and a Paystack STK push is triggered; the actual
                        chamas.plan / planExpiry update happens when the PAY
                        repo's singleton webhook marks that reference
                        successful — mirroring mychama_sms_topup exactly.
                        This function does NOT apply the plan itself for a
                        paid upgrade. Moving to a plan with price 0 (or to
                        any plan whose price is <= the chama's CURRENT
                        plan's price — i.e. a same-price switch or a
                        downgrade) needs no payment and is applied
                        immediately.

  generateStatement   — finance admin (any member) or a member generating
                        their own. Renders the chama's `transactions` ledger
                        — the single append-only source of truth for every
                        financial event — for [from, to], as PDF or CSV,
                        uploads it to Cloud Storage and returns a signed URL.
                        Enforces PLANS[plan].exportsAllowed and
                        minutesQuota/minutesExportsUsedThisMonth.

  sweep_plan_expiry          — daily. Downgrades lapsed paid plans to Free
                                and sends a renewal reminder a few days out.
  reset_monthly_export_quota — runs on the 1st of the month. Zeroes
                                minutesExportsUsedThisMonth for every chama
                                (nothing did this before Phase 4 — a chama
                                that used its free export in month 1 would
                                otherwise have stayed locked out forever).

See TOUCH_BASE.md "Billing & statements" for what's still a manual/PAY-repo
follow-up (the PAY webhook's `mychama_plan_upgrade` branch, and the "pay
KES 100 for one more export" flow promised in the Billing screen's plan
copy but not wired to a real charge yet).
"""

from __future__ import annotations

import csv
import io
import secrets as pysecrets
from datetime import timedelta

from firebase_admin import firestore, storage
from firebase_functions import https_fn, scheduler_fn

from shared import firestore_paths as paths
from shared import ids
from shared import paystack
from shared.constants import MC, PLAN_ORDER, PLANS
from shared.dates import now_ms, today_iso, add_days_iso
from shared.errors import bad_request, not_found, precondition, rate_limited, require_auth, upstream_failure
from shared.idempotency import already_applied, record_result
from shared.money import kes
from shared.phone import detect_provider, is_valid_kenyan_phone, normalize_phone
from shared.roles import require_finance_admin, require_membership
from shared.secrets import PAYSTACK_SECRET_KEY, HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID
from shared.hostpinnacle import send_sms

REGION = "africa-south1"

# Signed URLs are valid for this long — long enough for someone to open a
# link from an SMS or a chat message without it going stale mid-read, short
# enough that a leaked link doesn't stay live forever.
STATEMENT_URL_TTL = timedelta(hours=48)


def _db():
    return firestore.client()


def _token(n: int = 10) -> str:
    return pysecrets.token_urlsafe(n).replace("-", "").replace("_", "")[:n].upper()


# --------------------------------------------------------------------- #
# upgradePlan
# --------------------------------------------------------------------- #

@https_fn.on_call(region=REGION, secrets=[PAYSTACK_SECRET_KEY])
def upgradePlan(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    target_plan = data.get("plan")
    phone = data.get("phone") or ""

    if not chama_id or target_plan not in PLAN_ORDER:
        raise bad_request("chamaId and a valid plan are required.")

    db = _db()
    # manageBilling is chair-only (see src/app/navConfig.ts PERMISSIONS) —
    # a treasurer can see the Billing screen but not act on it.
    membership = require_finance_admin(db, uid, chama_id)
    if membership.role != "chair":
        raise https_fn.HttpsError("permission-denied", "Only the chair can change the chama's plan.")

    chama_ref = db.document(paths.chama(chama_id))
    chama_snap = chama_ref.get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()
    current_plan = chama.get("plan", "free")

    if target_plan == current_plan:
        raise bad_request("The chama is already on this plan.")

    current_price = PLANS[current_plan]["price"]
    target_price = PLANS[target_plan]["price"]
    is_upgrade = target_price > current_price

    # A downgrade (or a lateral move to a cheaper/free tier) is blocked if
    # it would leave the chama over the new plan's member limit — mirrors
    # identity.py's addMember/addAdmin limit check exactly (ALL active
    # members, admins included).
    if not is_upgrade:
        limit = PLANS[target_plan]["memberLimit"]
        active_count = len(list(db.collection(paths.members(chama_id)).where("status", "==", "active").stream()))
        if active_count > limit:
            raise rate_limited(
                f"This chama has {active_count} active members, but {PLANS[target_plan]['name']} only allows {limit}. "
                "Remove members first or choose a higher plan."
            )

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    if not is_upgrade:
        # Free/cheaper plan, or a downgrade that passed the check above —
        # takes effect immediately, no payment involved.
        ts = now_ms()
        update = {"plan": target_plan, "updatedAt": ts}
        if target_plan == "free":
            update["autoRenew"] = False
        chama_ref.update(update)
        result = {"ok": True}
        record_result(db, chama_id, data.get("clientRequestId"), result)
        return result

    # Paid upgrade — needs a live STK push, same pending-record pattern as
    # purchaseSmsCredits (functions/mychama/sms.py).
    if not is_valid_kenyan_phone(phone):
        raise bad_request("A valid Kenyan phone number is required to pay for this plan.")

    reference = ids.build_plan_billing_reference(chama_id)
    ts = now_ms()
    normalized_phone = normalize_phone(phone)
    amount = float(target_price)

    db.document(paths.plan_billing_doc(chama_id, reference)).set({
        "chamaId": chama_id,
        "fromPlan": current_plan,
        "toPlan": target_plan,
        "amountKes": amount,
        "phone": normalized_phone,
        "status": "pending",
        "requestedBy": uid,
        "createdAt": ts,
        "expiresAt": ts + 30 * 60 * 1000,
    })

    try:
        paystack.charge_mobile_money(
            secret_key=PAYSTACK_SECRET_KEY.value,
            email=f"{chama_id}@mychama.app",
            amount_kes=amount,
            phone_e164=normalized_phone,
            provider=detect_provider(phone),
            reference=reference,
            metadata={"chargeType": "mychama_plan_upgrade", "targetProject": "mychama1", "chamaId": chama_id, "toPlan": target_plan},
        )
    except Exception as exc:  # noqa: BLE001
        db.document(paths.plan_billing_doc(chama_id, reference)).update({"status": "failed", "updatedAt": now_ms()})
        raise upstream_failure("Could not start the plan payment with Paystack. Please try again.") from exc

    result = {"reference": reference}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


# --------------------------------------------------------------------- #
# generateStatement
# --------------------------------------------------------------------- #

def _member_name_map(db, chama_id: str) -> dict:
    return {d.id: (d.to_dict() or {}).get("name", "Member") for d in db.collection(paths.members(chama_id)).stream()}


TX_LABEL = {
    "contribution": "Contribution",
    "loan_disbursement": "Loan disbursement",
    "loan_repayment": "Loan repayment",
    "mgr_contribution": "Merry-go-round contribution",
    "mgr_payout": "Merry-go-round payout",
}


def _fetch_transactions(db, chama_id: str, member_id: str | None, date_from: str, date_to: str, pot_id: str | None = None) -> list[dict]:
    q = db.collection(paths.transactions(chama_id)).where("date", ">=", date_from).where("date", "<=", date_to)
    if member_id:
        q = q.where("memberId", "==", member_id)
    if pot_id:
        q = q.where("potId", "==", pot_id)
    rows = [d.to_dict() for d in q.stream()]
    rows.sort(key=lambda r: (r.get("date", ""), r.get("createdAt", 0)))
    return rows


def _render_csv(chama_name: str, rows: list[dict], names: dict, scope_label: str, date_from: str, date_to: str) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([chama_name])
    w.writerow([f"Statement — {scope_label}"])
    w.writerow([f"{date_from} to {date_to}"])
    w.writerow([])
    w.writerow(["Date", "Type", "Member", "Direction", "Amount (KES)", "Method", "Reference", "Note"])
    total_in = total_out = 0.0
    for r in rows:
        amt = float(r.get("amount") or 0)
        if r.get("direction") == "in":
            total_in += amt
        else:
            total_out += amt
        w.writerow([
            r.get("date", ""),
            TX_LABEL.get(r.get("type", ""), r.get("type", "")),
            names.get(r.get("memberId", ""), r.get("memberId", "")),
            r.get("direction", ""),
            f"{amt:,.2f}",
            r.get("method") or "—",
            r.get("ref", ""),
            r.get("note") or "",
        ])
    w.writerow([])
    w.writerow(["Total in", f"{total_in:,.2f}"])
    w.writerow(["Total out", f"{total_out:,.2f}"])
    w.writerow(["Net", f"{total_in - total_out:,.2f}"])
    return buf.getvalue().encode("utf-8")


def _render_pdf(chama_name: str, rows: list[dict], names: dict, scope_label: str, date_from: str, date_to: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=16 * mm, rightMargin=16 * mm,
    )
    story = [
        Paragraph(chama_name, styles["Title"]),
        Paragraph(f"Statement — {scope_label}", styles["Heading3"]),
        Paragraph(f"{date_from} to {date_to} &middot; generated {today_iso()}", styles["Normal"]),
        Spacer(1, 10 * mm),
    ]

    data = [["Date", "Type", "Member", "Dir.", "Amount", "Method", "Reference"]]
    total_in = total_out = 0.0
    for r in rows:
        amt = float(r.get("amount") or 0)
        if r.get("direction") == "in":
            total_in += amt
        else:
            total_out += amt
        data.append([
            r.get("date", ""),
            TX_LABEL.get(r.get("type", ""), r.get("type", "")),
            names.get(r.get("memberId", ""), r.get("memberId", "")),
            "IN" if r.get("direction") == "in" else "OUT",
            kes(amt),
            r.get("method") or "—",
            r.get("ref", ""),
        ])
    if len(data) == 1:
        data.append(["—", "No transactions in this period", "", "", "", "", ""])

    table = Table(data, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F4D3A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F9F5")]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D8E8DC")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(table)
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(f"Total in: <b>{kes(total_in)}</b> &nbsp;&nbsp; Total out: <b>{kes(total_out)}</b> &nbsp;&nbsp; Net: <b>{kes(total_in - total_out)}</b>", styles["Normal"]))

    doc.build(story)
    return buf.getvalue()


def _render_minutes_pdf(chama_name: str, minute: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem

    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=16 * mm, rightMargin=16 * mm)
    story = [
        Paragraph(chama_name, styles["Title"]),
        Paragraph(minute.get("title", "Meeting minutes"), styles["Heading2"]),
        Paragraph(f"{minute.get('date', '')}" + (f" &middot; {minute.get('venue')}" if minute.get("venue") else ""), styles["Normal"]),
        Spacer(1, 6 * mm),
    ]

    def section(title: str, items: list[str]):
        if not items:
            return
        story.append(Paragraph(title, styles["Heading3"]))
        story.append(ListFlowable([ListItem(Paragraph(i, styles["Normal"])) for i in items], bulletType="bullet"))
        story.append(Spacer(1, 4 * mm))

    section("Attendees", minute.get("attendees") or [])
    section("Agenda", minute.get("agenda") or [])
    section("Resolutions", minute.get("resolutions") or [])
    if minute.get("aob"):
        story.append(Paragraph("Any other business", styles["Heading3"]))
        story.append(Paragraph(minute["aob"], styles["Normal"]))
        story.append(Spacer(1, 4 * mm))
    if minute.get("nextMeeting"):
        story.append(Paragraph(f"Next meeting: {minute['nextMeeting']}", styles["Normal"]))

    doc.build(story)
    return buf.getvalue()


STORAGE_BUCKET = "mychama1.firebasestorage.app"  # must match src/lib/firebase.ts storageBucket


def _upload_and_sign(chama_id: str, filename: str, content: bytes, content_type: str) -> str:
    bucket = storage.bucket(STORAGE_BUCKET)
    blob = bucket.blob(f"statements/{chama_id}/{filename}")
    blob.upload_from_string(content, content_type=content_type)
    # See TOUCH_BASE.md "Go-live checklist" — the Cloud Functions runtime
    # service account needs roles/iam.serviceAccountTokenCreator on itself
    # for generate_signed_url to work; without it this raises and the
    # error surfaces to the caller as an 'internal' failure.
    return blob.generate_signed_url(version="v4", expiration=STATEMENT_URL_TTL, method="GET")


@https_fn.on_call(region=REGION)
def generateStatement(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    member_id = data.get("memberId")
    date_from = data.get("from")
    date_to = data.get("to")
    fmt = data.get("format")
    minutes_id = data.get("minutesId")  # minimal, documented addition — see TOUCH_BASE.md
    pot_id = data.get("potId")  # optional — scopes the statement to one MGR pot, see mychama/mgr.py

    if not chama_id or fmt not in ("pdf", "csv"):
        raise bad_request("chamaId and a valid format ('pdf' or 'csv') are required.")
    if not minutes_id and (not date_from or not date_to):
        raise bad_request("from and to dates are required.")

    db = _db()
    membership = require_membership(db, uid, chama_id)

    if member_id and member_id != membership.member_id and not membership.is_finance_admin:
        raise https_fn.HttpsError("permission-denied", "You can only generate your own statement.")
    if not member_id and not membership.is_finance_admin:
        raise https_fn.HttpsError("permission-denied", "A whole-chama statement needs the chair or treasurer role.")

    chama_snap = db.document(paths.chama(chama_id)).get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()
    plan = chama.get("plan", "free")
    plan_cfg = PLANS.get(plan, PLANS["free"])

    if not plan_cfg["exportsAllowed"]:
        raise precondition(f"Exports aren't available on the {plan_cfg['name']} plan — upgrade to generate statements or export minutes.")

    quota = plan_cfg["minutesQuota"]
    used = chama.get("minutesExportsUsedThisMonth", 0)
    if quota is not None and used >= quota:
        raise precondition(
            f"This chama has used its {quota} free export{'s' if quota != 1 else ''} for this month. "
            "More free exports are available next month, or upgrade the plan for a higher (or unlimited) allowance."
        )

    chama_ref = db.document(paths.chama(chama_id))
    chama_name = chama.get("name", "MyChama")

    if minutes_id:
        minute_snap = db.document(f"{paths.minutes(chama_id)}/{minutes_id}").get()
        if not minute_snap.exists:
            raise not_found("Minutes not found.")
        content = _render_minutes_pdf(chama_name, minute_snap.to_dict())
        filename = f"minutes-{minutes_id}-{now_ms()}.pdf"
        content_type = "application/pdf"
    else:
        names = _member_name_map(db, chama_id)
        pot_label = None
        if pot_id:
            pot_snap = db.document(paths.mgr_pot(chama_id, pot_id)).get()
            if not pot_snap.exists:
                raise not_found("Merry-go-round pot not found.")
            pot_label = pot_snap.to_dict().get("name", "Merry-go-round")
        base_label = names.get(member_id, "Member") if member_id else "Whole chama"
        scope_label = f"{pot_label} — {base_label}" if pot_label else base_label
        rows = _fetch_transactions(db, chama_id, member_id, date_from, date_to, pot_id)
        if fmt == "csv":
            content = _render_csv(chama_name, rows, names, scope_label, date_from, date_to)
            content_type = "text/csv"
        else:
            content = _render_pdf(chama_name, rows, names, scope_label, date_from, date_to)
            content_type = "application/pdf"
        filename = f"statement-{pot_id or member_id or 'chama'}-{date_from}-to-{date_to}-{_token(6)}.{fmt}"

    url = _upload_and_sign(chama_id, filename, content, content_type)

    chama_ref.update({"minutesExportsUsedThisMonth": used + 1, "updatedAt": now_ms()})
    return {"url": url}


# --------------------------------------------------------------------- #
# Scheduled sweeps
# --------------------------------------------------------------------- #

def _chair_phone(db, chama_id: str) -> str | None:
    # Filters on status only (auto-indexed) and picks the chair in Python —
    # a chama has at most a handful of active members, and this avoids
    # needing a new role+status composite index just for a once-a-day sweep.
    for d in db.collection(paths.members(chama_id)).where("status", "==", "active").stream():
        m = d.to_dict() or {}
        if m.get("role") == "chair":
            return m.get("phoneNormalized")
    return None


@scheduler_fn.on_schedule(
    schedule="every day 00:40",
    region="us-central1",
    timezone=scheduler_fn.Timezone("Africa/Nairobi"),
    secrets=[HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID],
)
def sweep_plan_expiry(event: scheduler_fn.ScheduledEvent) -> None:
    """
    Downgrades any chama whose paid plan has lapsed, and sends the chair a
    one-time reminder 3 days before expiry. MyChama cannot silently
    re-charge an M-Pesa/Airtel STK push (it needs a live PIN entry), so
    "auto-renew" is a reminder, not a real auto-charge — see
    TOUCH_BASE.md "Plan auto-renew".
    """
    db = _db()
    today = today_iso()
    reminder_date = add_days_iso(3)

    # Single equality filter only (status=='active') — deliberately, so this
    # doesn't need a new composite index; the plan!='free' check happens in
    # Python below instead of as a second Firestore filter.
    chamas = db.collection(MC.CHAMAS).where("status", "==", "active").stream()
    for doc in chamas:
        chama = doc.to_dict()
        if chama.get("plan", "free") == "free":
            continue
        expiry = chama.get("planExpiry")
        if not expiry:
            continue

        if expiry < today:
            doc.reference.update({"plan": "free", "autoRenew": False, "updatedAt": now_ms()})
            phone = _chair_phone(db, doc.id)
            if phone:
                try:
                    send_sms(
                        userid=HP_USERID.value, password=HP_PASSWORD.value, apikey=HP_APIKEY.value,
                        sender_id=HP_SENDER_ID.value, phone_e164=phone,
                        message=f"{chama.get('name', 'Your chama')}'s MyChama plan has expired and moved to Free. "
                                "Upgrade any time from Plan & Billing to restore paid features.",
                    )
                except Exception:  # noqa: BLE001
                    pass
        elif expiry == reminder_date and chama.get("autoRenew"):
            phone = _chair_phone(db, doc.id)
            if phone:
                try:
                    send_sms(
                        userid=HP_USERID.value, password=HP_PASSWORD.value, apikey=HP_APIKEY.value,
                        sender_id=HP_SENDER_ID.value, phone_e164=phone,
                        message=f"{chama.get('name', 'Your chama')}'s MyChama plan renews on {expiry}. "
                                "Open Plan & Billing to pay — MyChama can't charge automatically for M-Pesa/Airtel plans.",
                    )
                except Exception:  # noqa: BLE001
                    pass


@scheduler_fn.on_schedule(schedule="1 of month 00:30", region="us-central1", timezone=scheduler_fn.Timezone("Africa/Nairobi"))
def reset_monthly_export_quota(event: scheduler_fn.ScheduledEvent) -> None:
    """Nothing reset this before Phase 4 — a chama that used its one free
    export in its first month would otherwise stay locked out forever."""
    db = _db()
    batch = db.batch()
    n = 0
    for doc in db.collection(MC.CHAMAS).where("status", "==", "active").stream():
        batch.update(doc.reference, {"minutesExportsUsedThisMonth": 0})
        n += 1
        if n % 400 == 0:  # batched writes cap at 500
            batch.commit()
            batch = db.batch()
    if n % 400 != 0:
        batch.commit()
