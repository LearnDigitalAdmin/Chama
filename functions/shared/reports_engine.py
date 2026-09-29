"""
Reports engine — Phase 4 extension.

Everything a report needs that ISN'T "which specific numbers go in a
Contribution Ledger" lives here: the credit/quota accounting shared by
every report type (standard pool, premium pool, prepaid wallet, Starter/
Basic à la carte), PDF encryption + the admin SMS PIN, and the four data
aggregations this patch adds (Contribution Ledger, Arrears & Penalties,
P&L, Balance Sheet). `generateStatement` (functions/mychama/billing.py,
pre-existing) and `generateReport` (functions/mychama/reports.py, new)
both call into this module so there is exactly ONE place that decides
"can this chama afford this report, and how".

See functions/shared/constants.py's PLANS/REPORT_TYPES docstrings for the
pricing model this implements, and docs/ARCHITECTURE.md "Reports engine"
for the encryption/PIN policy.

IMPORTANT — approximations flagged, not hidden:
  - `build_profit_and_loss` apportions loan interest income from blended
    repayment amounts (the loan schedule doesn't timestamp WHEN each
    installment was paid, only whether it's paid) — see that function's
    docstring.
  - `build_balance_sheet`'s loan-receivable figure uses each loan's
    CURRENT `paidAmount` bookkeeping regardless of `asOf` — a fully
    historical point-in-time reconstruction isn't possible from this data
    model without a payment-history log. Flagged inline.
  - `build_arrears_penalties` has no "penalty fee" to report yet — no
    chama in this schema tracks a late-fee amount. The report says so
    rather than inventing a number.
"""

from __future__ import annotations

import io
import secrets as pysecrets
import urllib.request
from datetime import datetime, timezone
from typing import Literal

from firebase_admin import firestore, storage

from . import firestore_paths as paths
from .constants import MC, PLANS, REPORT_TYPES, ReportTier, ReportPeriodMode
from .dates import today_iso, now_ms
from .errors import bad_request, not_found, precondition, rate_limited
from .money import kes

REGION_STORAGE_BUCKET = "mychama1.firebasestorage.app"  # matches functions/mychama/billing.py — must stay in sync


# --------------------------------------------------------------------- #
# Period resolution — the UI offers named presets; the server turns them
# into concrete dates so no date math ever has to be trusted from the
# client (see docs/API_CONTRACT.md "generateReport").
# --------------------------------------------------------------------- #

PeriodPreset = Literal[
    "this_month", "last_month", "this_quarter", "last_quarter",
    "this_fy", "last_fy", "custom",
]


def _month_bounds(year: int, month: int) -> tuple[str, str]:
    from calendar import monthrange
    last_day = monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"


def resolve_range(preset: str | None, custom_from: str | None, custom_to: str | None, fiscal_year_start_month: int = 1) -> tuple[str, str]:
    """Returns (from, to) as ISO date strings for a RANGE-mode report."""
    today = datetime.now(timezone.utc)
    y, m = today.year, today.month

    if preset == "custom" or not preset:
        if not custom_from or not custom_to:
            raise precondition("A custom period needs both a from and a to date.")
        return custom_from, custom_to

    if preset == "this_month":
        return _month_bounds(y, m)
    if preset == "last_month":
        py, pm = (y - 1, 12) if m == 1 else (y, m - 1)
        return _month_bounds(py, pm)

    if preset in ("this_quarter", "last_quarter"):
        q_start_month = ((m - 1) // 3) * 3 + 1
        if preset == "last_quarter":
            q_start_month -= 3
            qy = y if q_start_month >= 1 else y - 1
            q_start_month = q_start_month if q_start_month >= 1 else q_start_month + 12
        else:
            qy = y
        start, _ = _month_bounds(qy, q_start_month)
        end_month = q_start_month + 2
        end_year = qy + (1 if end_month > 12 else 0)
        end_month = end_month if end_month <= 12 else end_month - 12
        _, end = _month_bounds(end_year, end_month)
        return start, end

    if preset in ("this_fy", "last_fy"):
        fy_start_month = fiscal_year_start_month or 1
        # Which fiscal year contains "today"?
        fy_year = y if m >= fy_start_month else y - 1
        if preset == "last_fy":
            fy_year -= 1
        start, _ = _month_bounds(fy_year, fy_start_month)
        end_month = fy_start_month - 1 if fy_start_month > 1 else 12
        end_year = fy_year + 1 if fy_start_month > 1 else fy_year
        _, end = _month_bounds(end_year, end_month)
        return start, end

    raise precondition(f"Unknown period preset '{preset}'.")


def resolve_as_of(preset: str | None, custom_as_of: str | None) -> str:
    """Returns an ISO date string for an AS_OF-mode report (Balance Sheet, Arrears & Penalties)."""
    if preset == "custom" or preset is None:
        return custom_as_of or today_iso()
    if preset == "today":
        return today_iso()
    # Named presets ("this_month" etc.) resolve to their END date for an as-of report —
    # "as of the end of last month" is the natural reading of that preset here.
    date_from, date_to = resolve_range(preset, None, None)
    return date_to


# --------------------------------------------------------------------- #
# Credit accounting — the single gate every paid report goes through.
# --------------------------------------------------------------------- #

def standard_used(chama: dict) -> float:
    """Falls back to the pre-engine field name for chamas provisioned before this patch."""
    if "standardReportsUsedThisMonth" in chama:
        return chama.get("standardReportsUsedThisMonth", 0) or 0
    return chama.get("minutesExportsUsedThisMonth", 0) or 0


def premium_used(chama: dict) -> float:
    return chama.get("premiumReportsUsedThisMonth", 0) or 0


def wallet_balance(chama: dict) -> float:
    return chama.get("reportCreditsBalance", 0) or 0


def spend_credits(db, chama_ref, chama: dict, report_key: str) -> dict:
    """
    Atomically charges `report_key`'s credit cost against the chama's
    monthly allowance, then its prepaid wallet, in a single transaction.
    Raises `precondition` (plan doesn't offer this tier at all — Starter/
    Basic + a premium report) or `rate_limited` (allowance AND wallet both
    exhausted — a "top up or upgrade" case, not a hard plan block) if it
    can't be covered. Returns a small dict describing what was charged,
    for logging/response purposes; does NOT render or upload anything.

    Callers MUST call this (or the free-self-service / à la carte-consume
    path) before rendering — never render first and charge after; a
    failed charge must mean nothing was generated.
    """
    spec = REPORT_TYPES[report_key]
    cost = spec["credits"]
    plan = chama.get("plan", "free")
    plan_cfg = PLANS.get(plan, PLANS["free"])

    if not plan_cfg["exportsAllowed"]:
        raise precondition(f"Reports aren't available on the {plan_cfg['name']} plan — upgrade to generate them.")

    if spec["tier"] == ReportTier.PREMIUM and plan_cfg["premiumReportCredits"] == 0:
        # Starter/Basic: premium reports are not covered by any pool here —
        # see functions/mychama/reports.py::purchasePremiumReportAlaCarte.
        raise precondition(
            f"{spec['label']} isn't included on the {plan_cfg['name']} plan. "
            "Buy it as a one-off, or upgrade to Growth for unlimited standard reports plus a monthly premium allowance."
        )

    @firestore.transactional
    def _txn(transaction: firestore.Transaction) -> dict:
        snap = chama_ref.get(transaction=transaction)
        c = snap.to_dict() or {}
        wallet = wallet_balance(c)

        if spec["tier"] == ReportTier.STANDARD:
            quota = plan_cfg["standardReportCredits"]
            used = standard_used(c)
            if quota is None or used + cost <= quota:
                transaction.update(chama_ref, {
                    "standardReportsUsedThisMonth": used + cost,
                    "minutesExportsUsedThisMonth": used + cost,  # kept in lockstep — see LEGACY note in types.py
                    "updatedAt": now_ms(),
                })
                return {"source": "standardAllowance", "creditsCharged": cost, "walletAfter": wallet}
            if wallet >= cost:
                transaction.update(chama_ref, {"reportCreditsBalance": wallet - cost, "updatedAt": now_ms()})
                return {"source": "wallet", "creditsCharged": cost, "walletAfter": wallet - cost}
            raise rate_limited(
                f"This chama has used its {quota} free standard report credit{'s' if quota != 1 else ''} for this month. "
                "Top up report credits, or wait for next month's allowance."
            )

        # Premium — only reachable here for Growth/Max (Starter/Basic raised above).
        quota = plan_cfg["premiumReportCredits"]
        used = premium_used(c)
        if used + cost <= quota:
            transaction.update(chama_ref, {"premiumReportsUsedThisMonth": used + cost, "updatedAt": now_ms()})
            return {"source": "premiumAllowance", "creditsCharged": cost, "walletAfter": wallet}
        if wallet >= cost:
            transaction.update(chama_ref, {"reportCreditsBalance": wallet - cost, "updatedAt": now_ms()})
            return {"source": "wallet", "creditsCharged": cost, "walletAfter": wallet - cost}
        raise rate_limited(
            f"This chama has used its {quota} free premium report credit{'s' if quota != 1 else ''} for this month. "
            "Top up report credits to generate more."
        )

    return _txn(db.transaction())


def consume_alacarte_purchase(db, chama_id: str, report_key: str, reference: str) -> dict:
    """
    Marks a Starter/Basic one-off premium purchase 'consumed' and returns
    its saved parameters — used by both generateStatement (Cashflow) and
    generateReport (P&L, Balance Sheet) so a paid-for report can't be
    silently redirected to different parameters by resending different
    ones in the generation call. Raises if the reference doesn't exist,
    hasn't completed payment, or doesn't match `report_key`.
    """
    @firestore.transactional
    def _txn(transaction: firestore.Transaction) -> dict:
        ref = db.document(paths.report_alacarte_purchase(chama_id, reference))
        snap = ref.get(transaction=transaction)
        if not snap.exists:
            raise not_found("That à la carte purchase reference was not found.")
        purchase = snap.to_dict()
        if purchase.get("status") != "success":
            raise precondition("That purchase hasn't completed payment yet.")
        if purchase.get("reportType") != report_key:
            raise bad_request("That purchase reference is for a different report type.")
        transaction.update(ref, {"status": "consumed", "updatedAt": now_ms()})
        return purchase

    return _txn(db.transaction())


def refund_charge(db, chama_id: str, chama_ref, report_key: str, charge_info: dict | None) -> None:
    """
    Best-effort reversal of a charge taken by spend_credits /
    consume_alacarte_purchase when the report then FAILS to render or upload.
    Charging happens before rendering on purpose (a failed charge must mean
    nothing was generated) — this is the other half of that promise: a
    failed generation must not cost the chama anything. Never raises; if the
    refund itself fails it is logged for a human to reconcile.
    """
    if not charge_info:
        return
    cost = REPORT_TYPES[report_key]["credits"]
    source = charge_info.get("source")
    try:
        if source == "standardAllowance":
            chama_ref.update({
                "standardReportsUsedThisMonth": firestore.Increment(-cost),
                "minutesExportsUsedThisMonth": firestore.Increment(-cost),
                "updatedAt": now_ms(),
            })
        elif source == "premiumAllowance":
            chama_ref.update({"premiumReportsUsedThisMonth": firestore.Increment(-cost), "updatedAt": now_ms()})
        elif source == "wallet":
            chama_ref.update({"reportCreditsBalance": firestore.Increment(cost), "updatedAt": now_ms()})
        elif source == "alacarte" and charge_info.get("reference"):
            db.document(paths.report_alacarte_purchase(chama_id, charge_info["reference"])).update(
                {"status": "success", "updatedAt": now_ms()}
            )
    except Exception:  # noqa: BLE001
        import logging
        logging.exception("refund_charge failed for chama=%s report=%s charge=%s — reconcile manually", chama_id, report_key, charge_info)


# --------------------------------------------------------------------- #
# Encryption + admin PIN.
# --------------------------------------------------------------------- #

def generate_pin() -> str:
    """Cryptographically-random 6-digit PIN — never logged, never returned to the caller; SMS only."""
    return f"{pysecrets.randbelow(1_000_000):06d}"


def build_encryption(pin: str):
    """
    A reportlab `StandardEncryption` object, ready to pass as the optional
    `encrypt_enc` argument every `render_*_pdf` function below accepts.
    reportlab has no "encrypt an existing PDF" API — the document has to
    be BUILT with encryption already attached — so this is a factory, not
    a post-processing step. Owner password is a random, never-surfaced
    value (blocks the print/edit-permission bits from being lifted even
    if the 6-digit user PIN is somehow guessed); only the userPassword
    (the PIN) is ever given to a person, and only via SMS — never in a
    callable's return value.
    """
    from reportlab.lib.pdfencrypt import StandardEncryption
    owner_password = pysecrets.token_urlsafe(18)
    return StandardEncryption(pin, ownerPassword=owner_password, canPrint=1, canModify=0, canCopy=0, canAnnotate=0)


def notify_pin(db, chama: dict, pin: str, report_label: str, phones: list[str]) -> list[str]:
    """
    Sends the PIN via HostPinnacle directly — same low-level call
    sms.py's sendSmsCampaign uses, but this deliberately BYPASSES the
    smsCredits deduction path: a security notification isn't a billable
    campaign message, exactly like an OTP. Returns the phone numbers it
    actually reached (for logging/response purposes) — never raises; a
    PIN SMS failure shouldn't fail report generation (the PDF is already
    generated and paid for), so failures are swallowed here and should be
    watched via Cloud Logging instead.
    """
    from .hostpinnacle import send_sms
    from .phone import normalize_sms_phone
    from .secrets import HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID

    chama_name = chama.get("name", "MyChama")
    message = f"{chama_name}: your {report_label} PDF is ready. Open-file PIN: {pin}. Do not share this PIN."

    sent_to: list[str] = []
    for phone in phones:
        try:
            send_sms(
                userid=HP_USERID.value, password=HP_PASSWORD.value,
                apikey=HP_APIKEY.value, sender_id=HP_SENDER_ID.value,
                phone_e164=normalize_sms_phone(phone), message=message,
            )
            sent_to.append(phone)
        except Exception:  # noqa: BLE001 — see docstring
            continue
    return sent_to


def admin_pin_recipients(db, chama_id: str) -> list[str]:
    """Chair + treasurer's phones — the default recipients for an admin-pulled report's PIN."""
    admins = [m.to_dict() for m in db.collection(paths.members(chama_id)).where("status", "==", "active").stream()]
    return [m["phoneNormalized"] for m in admins if m.get("role") in ("chair", "treasurer") and m.get("phoneNormalized")]


def get_service_account_email() -> str | None:
    """
    Fetches the runtime service account email from the GCP Metadata Server.
    Only reachable from inside GCP compute (Cloud Functions/Cloud Run/GCE) —
    fails closed (returns None) anywhere else, e.g. local emulation, so
    upload_and_sign's fallback there is to let the client library try its
    own default signing behavior. 2s timeout so a signing call never hangs
    if metadata is unexpectedly unreachable.
    """
    try:
        url = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email"
        req = urllib.request.Request(url)
        req.add_header("Metadata-Flavor", "Google")
        with urllib.request.urlopen(req, timeout=2) as response:
            return response.read().decode("utf-8")
    except Exception:
        return None


def upload_and_sign(chama_id: str, filename: str, content: bytes, content_type: str, ttl) -> str:
    bucket = storage.bucket(REGION_STORAGE_BUCKET)
    blob = bucket.blob(f"statements/{chama_id}/{filename}")
    blob.upload_from_string(content, content_type=content_type)

    import google.auth
    from google.auth.transport import requests as gauth_requests

    credentials, _ = google.auth.default()
    credentials.refresh(gauth_requests.Request())

    return blob.generate_signed_url(
        version="v4",
        expiration=ttl,
        method="GET",
        service_account_email=credentials.service_account_email,
        access_token=credentials.token,
    )

    
# --------------------------------------------------------------------- #
# Shared small helpers used by more than one builder below.
# --------------------------------------------------------------------- #

def _member_name_map(db, chama_id: str) -> dict:
    return {d.id: (d.to_dict() or {}).get("name", "Member") for d in db.collection(paths.members(chama_id)).stream()}


def _pdf_styles():
    from reportlab.lib.styles import getSampleStyleSheet
    return getSampleStyleSheet()


def _base_doc(buf, encrypt_enc=None):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate
    kwargs = dict(pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=16 * mm, rightMargin=16 * mm)
    if encrypt_enc is not None:
        kwargs["encrypt"] = encrypt_enc
    return SimpleDocTemplate(buf, **kwargs)


def _styled_table(data: list[list[str]]):
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle
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
    return table


# --------------------------------------------------------------------- #
# 1. Contribution Summary & Tracking Ledger
# --------------------------------------------------------------------- #

def build_contribution_ledger(db, chama_id: str, date_from: str, date_to: str) -> dict:
    period_from = date_from[:7]  # periodKey is YYYY-MM
    period_to = date_to[:7]
    rows = [
        d.to_dict()
        for d in db.collection(paths.contributions(chama_id))
        .where("periodKey", ">=", period_from).where("periodKey", "<=", period_to)
        .stream()
    ]
    names = _member_name_map(db, chama_id)

    by_member: dict[str, dict] = {}
    for r in rows:
        mid = r.get("memberId", "")
        b = by_member.setdefault(mid, {"memberId": mid, "name": names.get(mid, "Member"), "due": 0.0, "paid": 0.0, "periods": []})
        b["due"] += float(r.get("amount") or 0)
        b["paid"] += float(r.get("paidAmount") or 0)
        b["periods"].append({"period": r.get("period", r.get("periodKey", "")), "status": r.get("status", ""), "due": r.get("amount"), "paid": r.get("paidAmount")})

    members_out = sorted(by_member.values(), key=lambda b: b["name"])
    for b in members_out:
        b["outstanding"] = round(b["due"] - b["paid"], 2)

    return {
        "reportType": "contribution_ledger",
        "dateFrom": date_from, "dateTo": date_to,
        "members": members_out,
        "totals": {
            "due": round(sum(b["due"] for b in members_out), 2),
            "paid": round(sum(b["paid"] for b in members_out), 2),
            "outstanding": round(sum(b["outstanding"] for b in members_out), 2),
        },
    }


def render_contribution_ledger_pdf(chama_name: str, data: dict, encrypt_enc=None) -> bytes:
    from reportlab.platypus import Paragraph, Spacer
    styles = _pdf_styles()
    buf = io.BytesIO()
    doc = _base_doc(buf, encrypt_enc)
    story = [
        Paragraph(chama_name, styles["Title"]),
        Paragraph("Contribution Summary &amp; Tracking Ledger", styles["Heading3"]),
        Paragraph(f"{data['dateFrom']} to {data['dateTo']} &middot; generated {today_iso()}", styles["Normal"]),
        Spacer(1, 8),
    ]
    table_rows = [["Member", "Due (KES)", "Paid (KES)", "Outstanding (KES)"]]
    for b in data["members"]:
        table_rows.append([b["name"], f"{b['due']:,.2f}", f"{b['paid']:,.2f}", f"{b['outstanding']:,.2f}"])
    if len(table_rows) == 1:
        table_rows.append(["—", "No contributions in this period", "", ""])
    story.append(_styled_table(table_rows))
    story.append(Spacer(1, 8))
    t = data["totals"]
    story.append(Paragraph(
        f"Total due: <b>{kes(t['due'])}</b> &nbsp; Total paid: <b>{kes(t['paid'])}</b> &nbsp; Outstanding: <b>{kes(t['outstanding'])}</b>",
        styles["Normal"],
    ))
    doc.build(story)
    return buf.getvalue()


def render_contribution_ledger_csv(data: dict) -> bytes:
    import csv
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Contribution Summary & Tracking Ledger", f"{data['dateFrom']} to {data['dateTo']}"])
    w.writerow([])
    w.writerow(["Member", "Due", "Paid", "Outstanding"])
    for b in data["members"]:
        w.writerow([b["name"], b["due"], b["paid"], b["outstanding"]])
    w.writerow([])
    t = data["totals"]
    w.writerow(["Total", t["due"], t["paid"], t["outstanding"]])
    return buf.getvalue().encode("utf-8")


# --------------------------------------------------------------------- #
# 2. Arrears & Penalties Report
# --------------------------------------------------------------------- #

def build_arrears_penalties(db, chama_id: str, as_of: str) -> dict:
    names = _member_name_map(db, chama_id)

    # Contribution arrears — reconstructed from dueDate/paidAmount rather than
    # the mutable `status` field, so an as_of DATE actually means something
    # (status only reflects the LATEST sweep, not history).
    contrib_arrears = []
    for d in db.collection(paths.contributions(chama_id)).where("dueDate", "<=", as_of).stream():
        r = d.to_dict()
        owed = round(float(r.get("amount") or 0) - float(r.get("paidAmount") or 0), 2)
        if owed > 0:
            contrib_arrears.append({"memberId": r.get("memberId"), "name": names.get(r.get("memberId"), "Member"), "period": r.get("period"), "dueDate": r.get("dueDate"), "owed": owed})

    # Loan arrears — from each active/overdue loan's own schedule.
    loan_arrears = []
    for d in db.collection(paths.loans(chama_id)).where("status", "in", ["active", "overdue"]).stream():
        loan = d.to_dict()
        overdue_amt = sum(
            round(float(i.get("due") or 0) - float(i.get("paidAmount") or 0), 2)
            for i in (loan.get("schedule") or [])
            if i.get("dueDate", "9999-12-31") <= as_of and not i.get("paid")
        )
        if overdue_amt > 0:
            loan_arrears.append({"memberId": loan.get("memberId"), "name": names.get(loan.get("memberId"), "Member"), "loanId": d.id, "owed": round(overdue_amt, 2)})

    # MGR arrears — per-pot subcollections (mirrors mychama/mgr.py's _all_arrears
    # iteration rather than a collection-group query — no chamaId field is
    # stored on the arrear doc itself, so scoping happens via the pot loop).
    mgr_arrears = []
    as_of_ms = int(datetime.strptime(as_of, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)
    for pot_doc in db.collection(paths.mgr_pots(chama_id)).stream():
        pot = pot_doc.to_dict()
        for a_doc in db.collection(paths.mgr_arrears(chama_id, pot_doc.id)).where("status", "==", "open").stream():
            a = a_doc.to_dict()
            if a.get("createdAt", 0) <= as_of_ms:
                mgr_arrears.append({"memberId": a.get("memberId"), "name": names.get(a.get("memberId"), "Member"), "pot": pot.get("name", "Merry-go-round"), "owed": a.get("amount", 0)})

    return {
        "reportType": "arrears_penalties",
        "asOf": as_of,
        "contributionArrears": contrib_arrears,
        "loanArrears": loan_arrears,
        "mgrArrears": mgr_arrears,
        "totals": {
            "contributions": round(sum(x["owed"] for x in contrib_arrears), 2),
            "loans": round(sum(x["owed"] for x in loan_arrears), 2),
            "mgr": round(sum(x["owed"] for x in mgr_arrears), 2),
        },
        # No chama in this schema tracks a late-fee/penalty AMOUNT field yet
        # (only overdue status). Reported honestly rather than invented —
        # see TOUCH_BASE.md "Reports engine — penalty fee field".
        "penaltiesNote": "No penalty-fee field is configured for this chama yet — this section will populate once one is added.",
    }


def render_arrears_penalties_pdf(chama_name: str, data: dict, encrypt_enc=None) -> bytes:
    from reportlab.platypus import Paragraph, Spacer
    styles = _pdf_styles()
    buf = io.BytesIO()
    doc = _base_doc(buf, encrypt_enc)
    story = [
        Paragraph(chama_name, styles["Title"]),
        Paragraph("Arrears &amp; Penalties Report", styles["Heading3"]),
        Paragraph(f"As of {data['asOf']} &middot; generated {today_iso()}", styles["Normal"]),
        Spacer(1, 8),
    ]

    story.append(Paragraph("Overdue contributions", styles["Heading4"]))
    t1 = [["Member", "Period", "Due date", "Owed (KES)"]] + (
        [[x["name"], x["period"], x["dueDate"], f"{x['owed']:,.2f}"] for x in data["contributionArrears"]] or [["—", "None outstanding", "", ""]]
    )
    story.append(_styled_table(t1))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Overdue loan installments", styles["Heading4"]))
    t2 = [["Member", "Loan", "Owed (KES)"]] + (
        [[x["name"], x["loanId"], f"{x['owed']:,.2f}"] for x in data["loanArrears"]] or [["—", "None outstanding", ""]]
    )
    story.append(_styled_table(t2))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Open merry-go-round arrears", styles["Heading4"]))
    t3 = [["Member", "Pot", "Owed (KES)"]] + (
        [[x["name"], x["pot"], f"{x['owed']:,.2f}"] for x in data["mgrArrears"]] or [["—", "None open", ""]]
    )
    story.append(_styled_table(t3))
    story.append(Spacer(1, 8))

    tt = data["totals"]
    story.append(Paragraph(
        f"Total overdue — contributions: <b>{kes(tt['contributions'])}</b>, loans: <b>{kes(tt['loans'])}</b>, MGR: <b>{kes(tt['mgr'])}</b>",
        styles["Normal"],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"<i>{data['penaltiesNote']}</i>", styles["Normal"]))
    doc.build(story)
    return buf.getvalue()


def render_arrears_penalties_csv(data: dict) -> bytes:
    import csv
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Arrears & Penalties Report", f"as of {data['asOf']}"])
    w.writerow([])
    w.writerow(["Type", "Member", "Detail", "Owed (KES)"])
    for x in data["contributionArrears"]:
        w.writerow(["Contribution", x["name"], x["period"], x["owed"]])
    for x in data["loanArrears"]:
        w.writerow(["Loan", x["name"], x["loanId"], x["owed"]])
    for x in data["mgrArrears"]:
        w.writerow(["MGR", x["name"], x["pot"], x["owed"]])
    w.writerow([])
    w.writerow([data["penaltiesNote"]])
    return buf.getvalue().encode("utf-8")


# --------------------------------------------------------------------- #
# 3. Profit & Loss Statement (premium)
# --------------------------------------------------------------------- #

def build_profit_and_loss(db, chama_id: str, date_from: str, date_to: str, plan: str) -> dict:
    """
    Revenue: loan interest income, apportioned from `loan_repayment`
    transactions in the period using each loan's blended interest ratio
    (totalInterest / totalPay) — an APPROXIMATION, since installments
    don't record a per-payment timestamp, only paid/unpaid. A repayment
    made mid-period is fully counted in that period even if it covered an
    installment due earlier.

    Expenses: Paystack + MyChama processing fees on money OUT (loan
    disbursements, MGR payouts) in the period, SMS spend logged in the
    period, and this chama's plan subscription cost prorated across the
    number of days in [date_from, date_to].
    """
    loans_by_id = {d.id: d.to_dict() for d in db.collection(paths.loans(chama_id)).stream()}

    tx = [
        d.to_dict()
        for d in db.collection(paths.transactions(chama_id))
        .where("date", ">=", date_from).where("date", "<=", date_to)
        .stream()
    ]

    interest_income = 0.0
    for t in tx:
        if t.get("type") != "loan_repayment":
            continue
        loan = loans_by_id.get(t.get("loanId") or "", {})
        total_pay = float(loan.get("totalPay") or 0)
        total_interest = float(loan.get("totalInterest") or 0)
        if total_pay > 0:
            interest_income += float(t.get("amount") or 0) * (total_interest / total_pay)

    processing_fees = sum(float(t.get("paystackFee") or 0) + float(t.get("ourFee") or 0) for t in tx if t.get("direction") == "out")

    # smsLog has no ISO `date` field, only epoch-ms `createdAt` — convert the
    # [date_from, date_to] bounds to an epoch-ms range once and compare directly.
    from_ms = int(datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)
    to_ms = int(datetime.strptime(date_to, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000) + 24 * 60 * 60 * 1000 - 1
    sms_expense = sum(
        float(s.to_dict().get("creditsUsed") or 0)
        for s in db.collection(paths.sms_log(chama_id)).stream()
        if from_ms <= (s.to_dict().get("createdAt") or 0) <= to_ms
    )
    days = max(1, (datetime.strptime(date_to, "%Y-%m-%d") - datetime.strptime(date_from, "%Y-%m-%d")).days + 1)
    plan_cost_prorated = PLANS.get(plan, PLANS["free"])["price"] * (days / 30.0)

    revenue_total = round(interest_income, 2)
    expense_total = round(processing_fees + sms_expense + plan_cost_prorated, 2)

    return {
        "reportType": "profit_loss",
        "dateFrom": date_from, "dateTo": date_to,
        "revenue": {"loanInterestIncome": round(interest_income, 2), "total": revenue_total},
        "expenses": {
            "paymentProcessingFees": round(processing_fees, 2),
            "smsSpend": round(sms_expense, 2),
            "planSubscription": round(plan_cost_prorated, 2),
            "total": expense_total,
        },
        "netProfit": round(revenue_total - expense_total, 2),
    }


def render_profit_and_loss_pdf(chama_name: str, data: dict, encrypt_enc=None) -> bytes:
    from reportlab.platypus import Paragraph, Spacer
    styles = _pdf_styles()
    buf = io.BytesIO()
    doc = _base_doc(buf, encrypt_enc)
    story = [
        Paragraph(chama_name, styles["Title"]),
        Paragraph("Profit &amp; Loss Statement", styles["Heading3"]),
        Paragraph(f"{data['dateFrom']} to {data['dateTo']} &middot; generated {today_iso()}", styles["Normal"]),
        Spacer(1, 8),
    ]
    r, e = data["revenue"], data["expenses"]
    story.append(_styled_table([
        ["Revenue", "KES"],
        ["Loan interest income", f"{r['loanInterestIncome']:,.2f}"],
        ["Total revenue", f"{r['total']:,.2f}"],
    ]))
    story.append(Spacer(1, 8))
    story.append(_styled_table([
        ["Expenses", "KES"],
        ["Payment processing fees", f"{e['paymentProcessingFees']:,.2f}"],
        ["SMS spend", f"{e['smsSpend']:,.2f}"],
        ["Plan subscription (prorated)", f"{e['planSubscription']:,.2f}"],
        ["Total expenses", f"{e['total']:,.2f}"],
    ]))
    story.append(Spacer(1, 10))
    story.append(Paragraph(f"Net {'profit' if data['netProfit'] >= 0 else 'loss'}: <b>{kes(abs(data['netProfit']))}</b>", styles["Heading3"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<i>Loan interest income is apportioned from blended repayments — see the report engine's documented approximation.</i>",
        styles["Normal"],
    ))
    doc.build(story)
    return buf.getvalue()


def render_profit_and_loss_csv(data: dict) -> bytes:
    import csv
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Profit & Loss Statement", f"{data['dateFrom']} to {data['dateTo']}"])
    w.writerow([])
    r, e = data["revenue"], data["expenses"]
    w.writerow(["Revenue"])
    w.writerow(["Loan interest income", r["loanInterestIncome"]])
    w.writerow(["Total revenue", r["total"]])
    w.writerow([])
    w.writerow(["Expenses"])
    w.writerow(["Payment processing fees", e["paymentProcessingFees"]])
    w.writerow(["SMS spend", e["smsSpend"]])
    w.writerow(["Plan subscription (prorated)", e["planSubscription"]])
    w.writerow(["Total expenses", e["total"]])
    w.writerow([])
    w.writerow(["Net profit/(loss)", data["netProfit"]])
    return buf.getvalue().encode("utf-8")


# --------------------------------------------------------------------- #
# 4. Balance Sheet (premium, point-in-time — NOT a from/to range)
# --------------------------------------------------------------------- #

def build_balance_sheet(db, chama_id: str, as_of: str, chama: dict) -> dict:
    """
    See this module's docstring for the loan-receivable approximation.
    Retained earnings/reserve is reported as a labeled BALANCING FIGURE
    (Assets − Liabilities − Member equity), not independently derived from
    period-by-period P&L history — see docs/ARCHITECTURE.md "Reports
    engine" for why that's a reasonable v1 simplification.
    """
    tx = [d.to_dict() for d in db.collection(paths.transactions(chama_id)).where("date", "<=", as_of).stream()]
    net_cash_movement = sum((float(t.get("amount") or 0) if t.get("direction") == "in" else -float(t.get("amount") or 0)) for t in tx)
    cash_position = round(float(chama.get("openingBalance") or 0) + net_cash_movement, 2)

    loans_receivable = 0.0
    for d in db.collection(paths.loans(chama_id)).where("status", "in", ["active", "overdue"]).stream():
        loan = d.to_dict()
        paid_total = sum(float(i.get("paidAmount") or 0) for i in (loan.get("schedule") or []))
        loans_receivable += max(0.0, float(loan.get("totalPay") or 0) - paid_total)

    mgr_arrears_receivable = 0.0
    mgr_exit_refunds_payable = 0.0
    mgr_exit_clawbacks_receivable = 0.0
    for pot_doc in db.collection(paths.mgr_pots(chama_id)).stream():
        for a in db.collection(paths.mgr_arrears(chama_id, pot_doc.id)).where("status", "==", "open").stream():
            mgr_arrears_receivable += float(a.to_dict().get("amount") or 0)
        for e in db.collection(paths.mgr_exits(chama_id, pot_doc.id)).where("status", "==", "open").stream():
            ed = e.to_dict()
            mgr_exit_refunds_payable += max(0.0, float(ed.get("refundDue") or 0) - float(ed.get("refundPaid") or 0))
            mgr_exit_clawbacks_receivable += max(0.0, float(ed.get("clawbackDue") or 0) - float(ed.get("clawbackRecovered") or 0))

    sms_prepaid = float(chama.get("smsCredits") or 0)
    from .constants import REPORT_WALLET_CREDIT_PRICE_KES
    report_credits_prepaid = float(chama.get("reportCreditsBalance") or 0) * REPORT_WALLET_CREDIT_PRICE_KES

    assets = {
        "cashAndBank": cash_position,
        "loansReceivable": round(loans_receivable, 2),
        "mgrArrearsReceivable": round(mgr_arrears_receivable, 2),
        "mgrExitClawbacksReceivable": round(mgr_exit_clawbacks_receivable, 2),
        "prepaidSmsCredits": round(sms_prepaid, 2),
        "prepaidReportCredits": round(report_credits_prepaid, 2),
    }
    total_assets = round(sum(assets.values()), 2)

    liabilities = {"mgrExitRefundsPayable": round(mgr_exit_refunds_payable, 2)}
    total_liabilities = round(sum(liabilities.values()), 2)

    member_equity = 0.0
    for m in db.collection(paths.members(chama_id)).where("status", "==", "active").stream():
        md = m.to_dict()
        member_equity += float(md.get("totalContributed") or 0) + float(md.get("creditBalance") or 0)
    member_equity = round(member_equity, 2)

    retained_earnings = round(total_assets - total_liabilities - member_equity, 2)

    return {
        "reportType": "balance_sheet",
        "asOf": as_of,
        "assets": assets, "totalAssets": total_assets,
        "liabilities": liabilities, "totalLiabilities": total_liabilities,
        "equity": {"memberContributionsAndCredit": member_equity, "retainedEarningsReserve": retained_earnings},
        "totalEquity": round(member_equity + retained_earnings, 2),
    }


def render_balance_sheet_pdf(chama_name: str, data: dict, encrypt_enc=None) -> bytes:
    from reportlab.platypus import Paragraph, Spacer
    styles = _pdf_styles()
    buf = io.BytesIO()
    doc = _base_doc(buf, encrypt_enc)
    story = [
        Paragraph(chama_name, styles["Title"]),
        Paragraph("Balance Sheet", styles["Heading3"]),
        Paragraph(f"As of {data['asOf']} &middot; generated {today_iso()}", styles["Normal"]),
        Spacer(1, 8),
    ]
    a = data["assets"]
    story.append(_styled_table([
        ["Assets", "KES"],
        ["Cash & bank", f"{a['cashAndBank']:,.2f}"],
        ["Loans receivable", f"{a['loansReceivable']:,.2f}"],
        ["Merry-go-round arrears receivable", f"{a['mgrArrearsReceivable']:,.2f}"],
        ["Merry-go-round exit clawbacks receivable", f"{a['mgrExitClawbacksReceivable']:,.2f}"],
        ["Prepaid SMS credits", f"{a['prepaidSmsCredits']:,.2f}"],
        ["Prepaid report credits", f"{a['prepaidReportCredits']:,.2f}"],
        ["Total assets", f"{data['totalAssets']:,.2f}"],
    ]))
    story.append(Spacer(1, 8))
    l = data["liabilities"]
    story.append(_styled_table([
        ["Liabilities", "KES"],
        ["Merry-go-round exit refunds payable", f"{l['mgrExitRefundsPayable']:,.2f}"],
        ["Total liabilities", f"{data['totalLiabilities']:,.2f}"],
    ]))
    story.append(Spacer(1, 8))
    eq = data["equity"]
    story.append(_styled_table([
        ["Equity", "KES"],
        ["Member contributions & credit balances", f"{eq['memberContributionsAndCredit']:,.2f}"],
        ["Retained earnings / reserve (balancing figure)", f"{eq['retainedEarningsReserve']:,.2f}"],
        ["Total equity", f"{data['totalEquity']:,.2f}"],
    ]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<i>Retained earnings/reserve is a balancing figure (assets − liabilities − member equity), "
        "not independently tracked period-by-period. Loan receivables use current repayment records "
        "rather than a strict historical reconstruction — see the report engine's documented approximations.</i>",
        styles["Normal"],
    ))
    doc.build(story)
    return buf.getvalue()


def render_balance_sheet_csv(data: dict) -> bytes:
    import csv
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Balance Sheet", f"as of {data['asOf']}"])
    w.writerow([])
    w.writerow(["Assets"])
    for k, v in data["assets"].items():
        w.writerow([k, v])
    w.writerow(["Total assets", data["totalAssets"]])
    w.writerow([])
    w.writerow(["Liabilities"])
    for k, v in data["liabilities"].items():
        w.writerow([k, v])
    w.writerow(["Total liabilities", data["totalLiabilities"]])
    w.writerow([])
    w.writerow(["Equity"])
    for k, v in data["equity"].items():
        w.writerow([k, v])
    w.writerow(["Total equity", data["totalEquity"]])
    return buf.getvalue().encode("utf-8")