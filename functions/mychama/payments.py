"""
Payments & Settlement — Phase 3.

initiatePayment is a faithful port of CYBER's mychama.payment.service.ts —
same fee math (functions/shared/money.py), same reference format
(functions/shared/ids.py, prefix MCA- instead of MCW-), same paymentIntents
shape. The PAY repo's singleton webhook (extended separately — see
docs/ARCHITECTURE.md §1/§4 and the PAY repo delivery notes) is what
actually applies the payment once Paystack confirms it; this callable only
ever gets the STK push started and records what was quoted to the member.

setupSettlementAccount / requestSettlementChange / approveSettlementChange
create/change the Paystack subaccount + split code a chama's collections
settle into. Bank/paybill/till codes for Paystack Kenya's subaccount API
are NOT hardcoded here — `PAYBILL_BANK_CODE`/`TILL_BANK_CODE` are
placeholders to fill in from Paystack's own /bank?currency=KES list before
going live; get this wrong and settlement money has nowhere valid to land,
so treat it as a go-live blocker, not a nice-to-have.
"""

from __future__ import annotations

from firebase_functions import https_fn
from firebase_admin import firestore

from shared import firestore_paths as paths
from shared import ids
from shared import paystack
from shared.constants import PLANS, SECURITY, IntentPurposeCode
from shared.dates import now_ms
from shared.errors import bad_request, not_found, precondition, rate_limited, require_auth
from shared.idempotency import already_applied, record_result
from shared.money import contribution_fees, loan_repayment_fees, mgr_contribution_fees
from shared.phone import detect_provider, is_valid_kenyan_phone, normalize_phone
from shared.roles import require_finance_admin, require_membership
from shared.secrets import PAYSTACK_SECRET_KEY

REGION = "africa-south1"

# TODO before go-live: confirm against Paystack's GET /bank?currency=KES&type=mobile_money
# (and the equivalent for paybill/till, which Paystack Kenya treats as bank-style
# settlement destinations under specific codes) — these are placeholders.
PAYBILL_BANK_CODE = "MPESA"
TILL_BANK_CODE = "MPESA"
BANK_CODE_BY_TYPE = {"paybill": PAYBILL_BANK_CODE, "till": TILL_BANK_CODE}


def _db():
    return firestore.client()


def _purpose_code(purpose: str) -> str:
    return {
        "contribution": IntentPurposeCode.CONTRIBUTION,
        "loan_repayment": IntentPurposeCode.LOAN_REPAYMENT,
        "mgr_contribution": IntentPurposeCode.MGR_CONTRIBUTION,
    }[purpose]


def _bank_code(account_type: str, explicit: str | None) -> str:
    if account_type == "bank":
        if not explicit:
            raise bad_request("bankCode is required for a bank settlement account.")
        return explicit
    return BANK_CODE_BY_TYPE[account_type]


def _create_subaccount_and_split(*, secret_key: str, chama_name: str, account_type: str, account_number: str, bank_code: str) -> str:
    sub = paystack.create_subaccount(
        secret_key=secret_key,
        business_name=chama_name,
        settlement_bank_code=bank_code,
        account_number=account_number,
    )
    subaccount_code = sub["data"]["subaccount_code"]
    split = paystack.create_split(secret_key=secret_key, name=f"{chama_name} settlement", subaccount_code=subaccount_code)
    return split["data"]["split_code"]


@https_fn.on_call(region=REGION, secrets=[PAYSTACK_SECRET_KEY])
def setupSettlementAccount(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    if not chama_id:
        raise bad_request("chamaId is required.")

    db = _db()
    membership = require_membership(db, uid, chama_id)
    if membership.role != "chair":
        from shared.errors import denied
        raise denied("Only the chair can set up the initial settlement account.")

    chama_ref = db.document(paths.chama(chama_id))
    chama_snap = chama_ref.get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()
    if chama.get("settlementSplitCode"):
        raise precondition("A settlement account is already set up — use requestSettlementChange to change it.")

    account_type = data.get("accountType")
    account_number = data.get("accountNumber") or ""
    bank_code = _bank_code(account_type, data.get("bankCode"))
    if account_type not in ("paybill", "till", "bank") or not account_number:
        raise bad_request("accountType and accountNumber are required.")

    split_code = _create_subaccount_and_split(
        secret_key=PAYSTACK_SECRET_KEY.value,
        chama_name=chama.get("name", "Chama"),
        account_type=account_type,
        account_number=account_number,
        bank_code=bank_code,
    )

    chama_ref.update({
        "settlementAccount": f"{account_type}:{account_number}",
        "settlementSplitCode": split_code,
        "updatedAt": now_ms(),
    })
    return {"settlementSplitCode": split_code}


@https_fn.on_call(region=REGION)
def requestSettlementChange(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    if not chama_id:
        raise bad_request("chamaId is required.")

    db = _db()
    membership = require_finance_admin(db, uid, chama_id)

    account_type = data.get("accountType")
    if account_type not in ("paybill", "till", "bank") or not data.get("accountNumber"):
        raise bad_request("accountType and accountNumber are required.")

    ts = now_ms()
    ref = db.collection(paths.settlement_account_requests(chama_id)).document()
    ref.set({
        "requestedBy": membership.member_id,
        "accountLabel": data.get("accountLabel") or f"{account_type} {data.get('accountNumber')}",
        "accountType": account_type,
        "accountNumber": data.get("accountNumber"),
        "bankCode": data.get("bankCode"),
        "status": "pending",
        "approvedBy": None,
        "createdAt": ts,
        "updatedAt": ts,
    })
    return {"requestId": ref.id}


@https_fn.on_call(region=REGION, secrets=[PAYSTACK_SECRET_KEY])
def approveSettlementChange(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    request_id = data.get("requestId")
    decision = data.get("decision")
    if not chama_id or not request_id or decision not in ("approve", "reject"):
        raise bad_request("chamaId, requestId, and decision are required.")

    db = _db()
    membership = require_finance_admin(db, uid, chama_id)

    req_ref = db.document(f"{paths.settlement_account_requests(chama_id)}/{request_id}")
    req_snap = req_ref.get()
    if not req_snap.exists:
        raise not_found("Request not found.")
    request = req_snap.to_dict()

    if request.get("status") != "pending":
        raise precondition("This request has already been decided.")
    if request.get("requestedBy") == membership.member_id:
        from shared.errors import denied
        raise denied("You can't approve your own settlement change request — ask another official.")

    if decision == "reject":
        req_ref.update({"status": "rejected", "approvedBy": membership.member_id, "updatedAt": now_ms()})
        return {"ok": True}

    chama_ref = db.document(paths.chama(chama_id))
    chama = chama_ref.get().to_dict()
    bank_code = _bank_code(request["accountType"], request.get("bankCode"))
    split_code = _create_subaccount_and_split(
        secret_key=PAYSTACK_SECRET_KEY.value,
        chama_name=chama.get("name", "Chama"),
        account_type=request["accountType"],
        account_number=request["accountNumber"],
        bank_code=bank_code,
    )

    ts = now_ms()
    req_ref.update({"status": "approved", "approvedBy": membership.member_id, "updatedAt": ts})
    chama_ref.update({
        "settlementAccount": f"{request['accountType']}:{request['accountNumber']}",
        "settlementSplitCode": split_code,
        "updatedAt": ts,
    })
    return {"ok": True}


@https_fn.on_call(region=REGION, secrets=[PAYSTACK_SECRET_KEY])
def initiatePayment(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    purpose = data.get("purpose")
    amount = data.get("amount")
    phone = data.get("phone") or ""

    if not chama_id or purpose not in ("contribution", "loan_repayment", "mgr_contribution"):
        raise bad_request("chamaId and a valid purpose are required.")
    if not isinstance(amount, (int, float)) or amount <= 0:
        raise bad_request("amount must be a positive number.")
    if not is_valid_kenyan_phone(phone):
        raise bad_request("A valid Kenyan phone number is required.")

    db = _db()
    membership = require_membership(db, uid, chama_id)

    chama_snap = db.document(paths.chama(chama_id)).get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()
    plan = chama.get("plan", "free")

    if not PLANS.get(plan, PLANS["free"])["onlineCollection"]:
        raise precondition("This chama's plan doesn't include online collections yet — pay in cash, or ask the chair to upgrade the plan.")
    if not chama.get("settlementSplitCode"):
        raise precondition("This chama hasn't set up a settlement account yet — ask the chair to set one up first.")

    # Rate limit: MAX_INTENTS_PER_HOUR per member, mirrors the bot's guard.
    one_hour_ago = now_ms() - 60 * 60 * 1000
    recent = list(
        db.collection(paths.payment_intents(chama_id))
        .where("memberId", "==", membership.member_id)
        .where("createdAt", ">=", one_hour_ago)
        .stream()
    )
    if len(recent) >= SECURITY["MAX_INTENTS_PER_HOUR"]:
        raise rate_limited("Too many payment attempts this hour. Please try again later.")

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    fee_calc = {
        "contribution": contribution_fees,
        "loan_repayment": lambda net: loan_repayment_fees(net, plan),
        "mgr_contribution": mgr_contribution_fees,
    }[purpose](float(amount))

    reference = ids.build_payment_reference(chama_id, _purpose_code(purpose))
    ts = now_ms()
    provider = detect_provider(phone)
    normalized_phone = normalize_phone(phone)

    intent = {
        "chamaId": chama_id,
        "memberId": membership.member_id,
        "purpose": purpose,
        "reference": reference,
        "amount": fee_calc["net"],
        "grossAmount": fee_calc["gross"],
        "paystackFee": fee_calc["paystackFee"],
        "ourFee": fee_calc["ourFee"],
        "currency": "KES",
        "phone": normalized_phone,
        "provider": provider,
        "status": "pending",
        "channel": "app",
        "contributionId": data.get("contributionId"),
        "loanId": data.get("loanId"),
        "installmentNo": data.get("installmentNo"),
        "potId": data.get("potId"),
        "potPeriod": data.get("potPeriod"),
        "splitCode": chama["settlementSplitCode"],
        "createdAt": ts,
        "updatedAt": ts,
        "expiresAt": ts + SECURITY["PAYMENT_INTENT_TTL_SECONDS"] * 1000,
    }
    db.document(paths.payment_intent(chama_id, reference)).set(intent)

    try:
        paystack_resp = paystack.charge_mobile_money(
            secret_key=PAYSTACK_SECRET_KEY.value,
            email=f"{membership.member_id}@mychama.app",
            amount_kes=fee_calc["gross"],
            phone_e164=normalized_phone,
            provider=provider,
            reference=reference,
            metadata={
                "chargeType": "mychama_payment",
                "targetProject": "mychama1",
                "chamaId": chama_id,
                "memberId": membership.member_id,
                "purpose": purpose,
                "splitCode": chama["settlementSplitCode"],
            },
        )
        db.document(paths.payment_intent(chama_id, reference)).update({
            "paystackMessage": paystack_resp.get("data", {}).get("display_text", paystack_resp.get("message", "")),
            "updatedAt": now_ms(),
        })
    except Exception as exc:  # noqa: BLE001 — surfacing Paystack failure as a clean rejection
        db.document(paths.payment_intent(chama_id, reference)).update({"status": "failed", "updatedAt": now_ms()})
        from shared.errors import upstream_failure
        raise upstream_failure("Could not start the payment with Paystack. Please try again.") from exc

    result = {
        "reference": reference,
        "grossAmount": fee_calc["gross"],
        "paystackFee": fee_calc["paystackFee"],
        "ourFee": fee_calc["ourFee"],
    }
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result
