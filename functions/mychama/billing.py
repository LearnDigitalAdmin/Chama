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

from firebase_admin import firestore
from firebase_functions import https_fn, scheduler_fn

from shared import firestore_paths as paths
from shared import ids
from shared import paystack
from shared import reports_engine
from shared.constants import MC, PLAN_ORDER, PLANS, REPORT_TYPES
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


def _render_pdf(chama_name: str, rows: list[dict], names: dict, scope_label: str, date_from: str, date_to: str, encrypt_enc=None) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc_kwargs = dict(
        pagesize=A4,
        topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=16 * mm, rightMargin=16 * mm,
    )
    if encrypt_enc is not None:
        doc_kwargs["encrypt"] = encrypt_enc
    doc = SimpleDocTemplate(buf, **doc_kwargs)
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


def _upload_and_sign(chama_id: str, filename: str, content: bytes, content_type: str) -> str:
    # See TOUCH_BASE.md "Go-live checklist" — the Cloud Functions runtime
    # service account needs roles/iam.serviceAccountTokenCreator on itself
    # for generate_signed_url to work; without it this raises and the
    # error surfaces to the caller as an 'internal' failure.
    # Delegates to shared/reports_engine.py so there's exactly one storage
    # bucket constant and one signed-URL TTL policy for every report type.
    return reports_engine.upload_and_sign(chama_id, filename, content, content_type, STATEMENT_URL_TTL)


@https_fn.on_call(region=REGION, secrets=[HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID])
def generateStatement(req: https_fn.CallableRequest) -> dict:
    """
    Member-scoped statement ('member_statement' — standard tier, and FREE
    with no credit charge at all when a member pulls their OWN, on any
    plan including Free — see reports_engine's spend_credits docstring
    and TOUCH_BASE.md "Reports engine — member self-serve carve-out"),
    minutes export ('minutes' — standard tier), or a whole-chama/pot
    statement ('cashflow' — PREMIUM tier as of this patch: Growth/Max
    monthly allowance, or Starter/Basic via a paid alacarteReference from
    purchasePremiumReportAlaCarte — see functions/mychama/reports.py).

    Encryption: member_statement is always encrypted (PII); cashflow is
    optional (`data.get('encrypt')`, default off — chamas routinely share
    an unencrypted whole-chama cashflow to the group); minutes is never
    encrypted. See functions/shared/constants.py REPORT_TYPES.
    """
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    member_id = data.get("memberId")
    date_from = data.get("from")
    date_to = data.get("to")
    fmt = data.get("format")
    minutes_id = data.get("minutesId")  # minimal, documented addition — see TOUCH_BASE.md
    pot_id = data.get("potId")  # optional — scopes the statement to one MGR pot, see mychama/mgr.py
    encrypt_requested = data.get("encrypt")
    alacarte_reference = data.get("alacarteReference")  # Starter/Basic consuming a paid whole-chama purchase
    period_preset = data.get("period")  # optional preset key — resolved server-side, see reports_engine.resolve_range

    if not chama_id or fmt not in ("pdf", "csv"):
        raise bad_request("chamaId and a valid format ('pdf' or 'csv') are required.")
    if not minutes_id and not period_preset and (not date_from or not date_to):
        raise bad_request("A period (or from and to dates) is required.")

    db = _db()
    membership = require_membership(db, uid, chama_id)

    if member_id and member_id != membership.member_id and not membership.is_finance_admin:
        raise https_fn.HttpsError("permission-denied", "You can only generate your own statement.")
    if not member_id and not membership.is_finance_admin:
        raise https_fn.HttpsError("permission-denied", "A whole-chama statement needs the chair or treasurer role.")

    chama_ref = db.document(paths.chama(chama_id))
    chama_snap = chama_ref.get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()
    chama_name = chama.get("name", "MyChama")

    if not minutes_id and period_preset:
        date_from, date_to = reports_engine.resolve_range(
            period_preset, date_from, date_to, chama.get("fiscalYearStartMonth", 1)
        )

    if minutes_id:
        report_key = "minutes"
    elif member_id:
        report_key = "member_statement"
    else:
        report_key = "cashflow"

    is_self_service = bool(member_id) and member_id == membership.member_id

    charge_info = None
    if is_self_service:
        pass  # free, no plan/credit check at all — see docstring
    elif report_key == "cashflow" and PLANS.get(chama.get("plan", "free"), PLANS["free"])["premiumReportCredits"] == 0:
        if not alacarte_reference:
            plan_cfg = PLANS.get(chama.get("plan", "free"), PLANS["free"])
            raise precondition(
                f"A whole-chama statement isn't included on the {plan_cfg['name']} plan. "
                "Buy it as a one-off first with purchasePremiumReportAlaCarte, then pass the reference here."
            )
        purchase = reports_engine.consume_alacarte_purchase(db, chama_id, "cashflow", alacarte_reference)
        date_from = purchase.get("dateFrom", date_from)
        date_to = purchase.get("dateTo", date_to)
        fmt = purchase.get("format", fmt)
        encrypt_requested = purchase.get("encrypt", encrypt_requested)
        charge_info = {"source": "alacarte", "reference": alacarte_reference}
    else:
        charge_info = reports_engine.spend_credits(db, chama_ref, chama, report_key)

    try:
        spec = REPORT_TYPES[report_key]
        encrypt = spec["encryptDefault"] if not spec["encryptOptional"] else bool(encrypt_requested if encrypt_requested is not None else spec["encryptDefault"])
        if fmt == "csv":
            encrypt = False  # see reports_engine module docstring — CSV encryption isn't implemented yet
        pin = reports_engine.generate_pin() if encrypt else None
        encrypt_enc = reports_engine.build_encryption(pin) if pin else None

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
                content = _render_pdf(chama_name, rows, names, scope_label, date_from, date_to, encrypt_enc)
                content_type = "application/pdf"
            filename = f"statement-{pot_id or member_id or 'chama'}-{date_from}-to-{date_to}-{_token(6)}.{fmt}"

        url = _upload_and_sign(chama_id, filename, content, content_type)
    except Exception:
        reports_engine.refund_charge(db, chama_id, chama_ref, report_key, charge_info)
        raise

    pin_sent_to: list[str] = []
    if pin:
        recipients = [membership_phone(db, chama_id, membership.member_id)] if is_self_service else reports_engine.admin_pin_recipients(db, chama_id)
        pin_sent_to = reports_engine.notify_pin(db, chama, pin, spec["label"], [p for p in recipients if p])

    return {"url": url, "encrypted": bool(pin), "pinSentTo": len(pin_sent_to), "charge": charge_info}


def membership_phone(db, chama_id: str, member_id: str) -> str | None:
    snap = db.document(paths.member(chama_id, member_id)).get()
    return (snap.to_dict() or {}).get("phoneNormalized") if snap.exists else None


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
    """
    Nothing reset this before Phase 4 — a chama that used its one free
    export in its first month would otherwise stay locked out forever.

    Extended by the reports engine (this patch) to also reset the two new
    monthly credit counters and the Starter/Basic à la carte cap counter.
    `minutesExportsUsedThisMonth` is kept reset in lockstep purely as a
    legacy fallback for any reader that hasn't been updated yet — see the
    LEGACY note on that field in functions/shared/types.py.
    """
    db = _db()
    batch = db.batch()
    n = 0
    for doc in db.collection(MC.CHAMAS).where("status", "==", "active").stream():
        batch.update(doc.reference, {
            "minutesExportsUsedThisMonth": 0,
            "standardReportsUsedThisMonth": 0,
            "premiumReportsUsedThisMonth": 0,
            "premiumAlacarteUsedThisMonth": 0,
        })
        n += 1
        if n % 400 == 0:  # batched writes cap at 500
            batch.commit()
            batch = db.batch()
    if n % 400 != 0:
        batch.commit()
