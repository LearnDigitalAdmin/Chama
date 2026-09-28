"""
Reports — Phase 4 extension (this patch).

generateReport                — the four NEW report types (contribution
                                ledger, arrears & penalties, P&L, balance
                                sheet). Individual Member Statement and
                                Cashflow (the whole-chama case of the same
                                statement) stay on the pre-existing
                                generateStatement in billing.py, now updated
                                to charge through the same
                                shared/reports_engine credit accounting.
                                Minutes exports are logged by
                                recordMinutesExport in billing.py (the PDF
                                itself is built client-side) — see that
                                module's docstring.

purchaseReportCredits         — prepaid wallet top-up. Exactly the
                                purchaseSmsCredits pattern (see
                                functions/mychama/sms.py): creates a
                                pending doc + Paystack STK push; the PAY
                                repo's webhook credits chamas.reportCreditsBalance
                                on success. NOT wired on the PAY side yet
                                — see TOUCH_BASE.md.

purchasePremiumReportAlaCarte — Starter/Basic one-off premium-report
                                purchase, capped at PLANS[plan].premiumAlacarteCapPerMonth
                                per month (checked and reserved AT PURCHASE
                                time, not at generation time, so several
                                pending payments can't add up past the
                                cap). Same PAY-webhook caveat as above.
"""

from __future__ import annotations

from datetime import timedelta

from firebase_admin import firestore
from firebase_functions import https_fn

from shared import firestore_paths as paths
from shared import ids
from shared import paystack
from shared import reports_engine as engine
from shared.constants import PLANS, REPORT_TYPES, ReportTier, SECURITY
from shared.dates import now_ms
from shared.errors import bad_request, not_found, precondition, rate_limited, require_auth, upstream_failure
from shared.idempotency import already_applied, record_result
from shared.phone import detect_provider, is_valid_kenyan_phone, normalize_phone
from shared.roles import require_finance_admin
from shared.secrets import PAYSTACK_SECRET_KEY, HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID

REGION = "africa-south1"
STATEMENT_URL_TTL = timedelta(hours=48)  # matches billing.py's STATEMENT_URL_TTL


def _db():
    return firestore.client()


NEW_REPORT_TYPES = ("contribution_ledger", "arrears_penalties", "profit_loss", "balance_sheet")


# The HostPinnacle secrets MUST be declared here: engine.notify_pin reads
# them at runtime to SMS the PDF's open-file PIN, and a Cloud Function only
# receives the secrets listed in its decorator. Without them every PIN SMS
# fails silently (notify_pin swallows send errors) and the admin is left
# holding an encrypted PDF with no PIN.
@https_fn.on_call(region=REGION, secrets=[HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID])
def generateReport(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    report_type = data.get("reportType")
    fmt = data.get("format")
    period_preset = data.get("period")
    date_from = data.get("from")
    date_to = data.get("to")
    as_of = data.get("asOf")
    encrypt_requested = data.get("encrypt")
    alacarte_reference = data.get("alacarteReference")  # set when consuming a paid Starter/Basic one-off

    if report_type not in NEW_REPORT_TYPES:
        raise bad_request(f"reportType must be one of {NEW_REPORT_TYPES}.")
    if fmt not in ("pdf", "csv"):
        raise bad_request("format must be 'pdf' or 'csv'.")

    db = _db()
    require_finance_admin(db, uid, chama_id)  # all four new report types are chama-wide, finance-admin only

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    chama_ref = db.document(paths.chama(chama_id))
    chama_snap = chama_ref.get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()
    plan = chama.get("plan", "free")
    plan_cfg = PLANS.get(plan, PLANS["free"])
    spec = REPORT_TYPES[report_type]

    # PDF-only, always-encrypted report types don't offer CSV — encryption
    # is the whole point of that tier and a CSV can't carry it the same way.
    if spec["encryptDefault"] and not spec["encryptOptional"] and fmt == "csv":
        raise bad_request(f"{spec['label']} is only available as an encrypted PDF, not CSV.")

    encrypt = spec["encryptDefault"] if not spec["encryptOptional"] else bool(encrypt_requested if encrypt_requested is not None else spec["encryptDefault"])
    if fmt == "csv":
        encrypt = False  # see note above generateReport's module docstring — CSV encryption isn't implemented yet

    # ---- Charging: monthly pool / wallet, OR consume a paid à la carte purchase. ----
    charge_info = None
    if spec["tier"] == ReportTier.PREMIUM and plan_cfg["premiumReportCredits"] == 0:
        # Starter/Basic — must have a successful, unconsumed à la carte purchase for this exact report.
        if not alacarte_reference:
            raise precondition(
                f"{spec['label']} isn't included on the {plan_cfg['name']} plan. "
                "Buy it as a one-off first with purchasePremiumReportAlaCarte, then pass the reference here."
            )

        purchase = engine.consume_alacarte_purchase(db, chama_id, report_type, alacarte_reference)
        # The purchase's own saved parameters are authoritative — a paid-for
        # report can't be silently redirected to a different period by
        # resending different from/to/asOf in this call.
        date_from = purchase.get("dateFrom", date_from)
        date_to = purchase.get("dateTo", date_to)
        as_of = purchase.get("asOf", as_of)
        fmt = purchase.get("format", fmt)
        encrypt = purchase.get("encrypt", encrypt)
        period_preset = "custom"  # the purchase's stored concrete dates win over any preset resent here
        charge_info = {"source": "alacarte", "reference": alacarte_reference}
    else:
        charge_info = engine.spend_credits(db, chama_ref, chama, report_type)

    try:
        # ---- Period resolution. ----
        fiscal_start = chama.get("fiscalYearStartMonth", 1)
        if spec["periodMode"] == "range":
            date_from, date_to = engine.resolve_range(period_preset, date_from, date_to, fiscal_start)
        else:  # as_of
            as_of = engine.resolve_as_of(period_preset, as_of)

        chama_name = chama.get("name", "MyChama")

        # ---- Build + render. ----
        if report_type == "contribution_ledger":
            report_data = engine.build_contribution_ledger(db, chama_id, date_from, date_to)
            render_pdf, render_csv = engine.render_contribution_ledger_pdf, engine.render_contribution_ledger_csv
        elif report_type == "arrears_penalties":
            report_data = engine.build_arrears_penalties(db, chama_id, as_of)
            render_pdf, render_csv = engine.render_arrears_penalties_pdf, engine.render_arrears_penalties_csv
        elif report_type == "profit_loss":
            report_data = engine.build_profit_and_loss(db, chama_id, date_from, date_to, plan)
            render_pdf, render_csv = engine.render_profit_and_loss_pdf, engine.render_profit_and_loss_csv
        else:  # balance_sheet
            report_data = engine.build_balance_sheet(db, chama_id, as_of, chama)
            render_pdf, render_csv = engine.render_balance_sheet_pdf, engine.render_balance_sheet_csv

        pin = None
        if fmt == "csv":
            content = render_csv(report_data)
            content_type = "text/csv"
        else:
            if encrypt:
                pin = engine.generate_pin()
                content = render_pdf(chama_name, report_data, engine.build_encryption(pin))
            else:
                content = render_pdf(chama_name, report_data, None)
            content_type = "application/pdf"

        filename = f"report-{report_type}-{chama_id}-{now_ms()}.{fmt}"
        url = engine.upload_and_sign(chama_id, filename, content, content_type, STATEMENT_URL_TTL)
    except Exception:
        engine.refund_charge(db, chama_id, chama_ref, report_type, charge_info)
        raise

    pin_sent_to: list[str] = []
    if pin:
        # All four new report types are finance-admin-only (chair/treasurer),
        # so the PIN always goes to the admins, never a self-service case.
        pin_sent_to = engine.notify_pin(db, chama, pin, spec["label"], engine.admin_pin_recipients(db, chama_id))

    result = {"url": url, "encrypted": bool(pin), "pinSentTo": len(pin_sent_to), "charge": charge_info}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION, secrets=[PAYSTACK_SECRET_KEY])
def purchaseReportCredits(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    credits = data.get("credits")
    phone = data.get("phone") or ""

    if not chama_id:
        raise bad_request("chamaId is required.")
    if not isinstance(credits, int) or credits <= 0:
        raise bad_request("credits must be a positive whole number.")
    if not is_valid_kenyan_phone(phone):
        raise bad_request("A valid Kenyan phone number is required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    from shared.constants import REPORT_WALLET_BUNDLES, REPORT_WALLET_CREDIT_PRICE_KES
    amount_kes = REPORT_WALLET_BUNDLES.get(credits, credits * REPORT_WALLET_CREDIT_PRICE_KES)

    reference = ids.build_report_credit_topup_reference(chama_id)
    ts = now_ms()
    normalized_phone = normalize_phone(phone)

    db.document(paths.report_credit_topup(chama_id, reference)).set({
        "chamaId": chama_id,
        "credits": credits,
        "amountKes": float(amount_kes),
        "phone": normalized_phone,
        "status": "pending",
        "createdAt": ts,
        "expiresAt": ts + SECURITY["PAYMENT_INTENT_TTL_SECONDS"] * 1000,
    })

    try:
        paystack.charge_mobile_money(
            secret_key=PAYSTACK_SECRET_KEY.value,
            email=f"{chama_id}@mychama.app",
            amount_kes=float(amount_kes),
            phone_e164=normalized_phone,
            provider=detect_provider(phone),
            reference=reference,
            metadata={"chargeType": "mychama_report_credit_topup", "targetProject": "mychama1", "chamaId": chama_id, "credits": credits},
        )
    except Exception as exc:  # noqa: BLE001
        db.document(paths.report_credit_topup(chama_id, reference)).update({"status": "failed", "updatedAt": now_ms()})
        raise upstream_failure("Could not start the top-up payment with Paystack. Please try again.") from exc

    result = {"reference": reference, "amountKes": amount_kes}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION, secrets=[PAYSTACK_SECRET_KEY])
def purchasePremiumReportAlaCarte(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    report_type = data.get("reportType")
    phone = data.get("phone") or ""
    fmt = data.get("format", "pdf")
    period_preset = data.get("period")

    if report_type not in ("cashflow", "profit_loss", "balance_sheet"):
        raise bad_request("reportType must be one of: cashflow, profit_loss, balance_sheet.")
    if not is_valid_kenyan_phone(phone):
        raise bad_request("A valid Kenyan phone number is required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    chama_ref = db.document(paths.chama(chama_id))
    chama_snap = chama_ref.get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()
    plan = chama.get("plan", "free")
    plan_cfg = PLANS.get(plan, PLANS["free"])
    cap = plan_cfg["premiumAlacarteCapPerMonth"]

    if cap is None:
        raise precondition(
            f"The {plan_cfg['name']} plan already includes premium reports in its monthly allowance — "
            "generate it directly with generateReport instead of buying it à la carte."
        )
    if cap == 0:
        raise precondition(f"Premium reports aren't available on the {plan_cfg['name']} plan.")

    from shared.constants import premium_alacarte_price_kes

    # Resolve any preset NOW and store concrete dates on the purchase doc —
    # a paid-for report must not drift to a different period if it's
    # consumed after a month/quarter boundary.
    spec = REPORT_TYPES[report_type]
    date_from, date_to, as_of = data.get("from"), data.get("to"), data.get("asOf")
    fiscal_start = chama.get("fiscalYearStartMonth", 1)
    if spec["periodMode"] == "range":
        date_from, date_to = engine.resolve_range(period_preset, date_from, date_to, fiscal_start)
    elif spec["periodMode"] == "as_of":
        as_of = engine.resolve_as_of(period_preset, as_of)

    @firestore.transactional
    def _reserve(transaction: firestore.Transaction) -> int:
        snap = chama_ref.get(transaction=transaction)
        c = snap.to_dict() or {}
        used = c.get("premiumAlacarteUsedThisMonth", 0) or 0
        if used >= cap:
            raise rate_limited(
                f"This chama has used its {cap} à la carte premium report{'s' if cap != 1 else ''} for this month. "
                "Upgrade to Growth for a monthly premium allowance instead."
            )
        transaction.update(chama_ref, {"premiumAlacarteUsedThisMonth": used + 1, "updatedAt": now_ms()})
        return used + 1

    _reserve(db.transaction())

    amount_kes = premium_alacarte_price_kes(report_type)
    reference = ids.build_report_alacarte_reference(chama_id)
    ts = now_ms()
    normalized_phone = normalize_phone(phone)

    # Store the RESOLVED dates (date_from/date_to/as_of above), never the raw
    # request values: the UI sends a preset ("last_quarter") with no from/to,
    # so saving data.get("from") would freeze None and the paid-for report
    # could not be generated (or, for a balance sheet, would silently fall
    # back to today's date).
    db.document(paths.report_alacarte_purchase(chama_id, reference)).set({
        "chamaId": chama_id,
        "reportType": report_type,
        "format": fmt,
        "encrypt": REPORT_TYPES[report_type]["encryptDefault"],
        "memberId": data.get("memberId"),
        "dateFrom": date_from,
        "dateTo": date_to,
        "asOf": as_of,
        "amountKes": float(amount_kes),
        "phone": normalized_phone,
        "status": "pending",
        "createdAt": ts,
        "expiresAt": ts + SECURITY["PAYMENT_INTENT_TTL_SECONDS"] * 1000,
    })

    try:
        paystack.charge_mobile_money(
            secret_key=PAYSTACK_SECRET_KEY.value,
            email=f"{chama_id}@mychama.app",
            amount_kes=float(amount_kes),
            phone_e164=normalized_phone,
            provider=detect_provider(phone),
            reference=reference,
            metadata={"chargeType": "mychama_report_alacarte", "targetProject": "mychama1", "chamaId": chama_id, "reportType": report_type},
        )
    except Exception as exc:  # noqa: BLE001
        db.document(paths.report_alacarte_purchase(chama_id, reference)).update({"status": "failed", "updatedAt": now_ms()})
        # Refund the reserved cap slot — the purchase never actually started.
        chama_ref.update({"premiumAlacarteUsedThisMonth": firestore.Increment(-1), "updatedAt": now_ms()})
        raise upstream_failure("Could not start the payment with Paystack. Please try again.") from exc

    result = {"reference": reference, "amountKes": amount_kes}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result
