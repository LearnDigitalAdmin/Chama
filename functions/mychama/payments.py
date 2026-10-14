"""
Payments & Settlement — Phase 3.

initiatePayment is a faithful port of CYBER's mychama.payment.service.ts —
same fee math (functions/shared/money.py), same reference format
(functions/shared/ids.py, prefix MCA- instead of MCW-), same paymentIntents
shape. The PAY repo's singleton webhook (extended separately — see
docs/ARCHITECTURE.md §1/§4 and the PAY repo delivery notes) is what
actually applies the payment once Paystack confirms it; this callable only
ever gets the STK push started and records what was quoted to the member.

initiatePayment also covers admin-initiated collection: pass `memberId` to
charge a DIFFERENT member than the caller (finance-admin only). This is
what the "Charge Paystack" action in Contributions.tsx and MgrPotDetail.tsx
calls, via the shared src/features/payments/AdminChargeButton.tsx
component — one callable, one fee/reference/rate-limit/idempotency path,
usable for any purpose already in the `purpose` dispatch table below
(currently `contribution` and `mgr_contribution` have UI wired to it;
`loan_repayment` works identically if a UI ever wants it, with zero
backend changes). The phone charged defaults to the target member's own
record on file. A finance admin MAY additionally pass `overridePhone` to
send the STK prompt to a different number instead (e.g. a spouse or agent
paying on the member's behalf, matching the demo's manual-number-entry
admin charge screen) — this never changes who the charge is recorded
against, only whose phone gets the prompt, and every override is stamped
on the paymentIntent (`phoneOverridden`, `memberPhoneOnFile`) for audit
rather than silently substituted. Self-pay (no `memberId`, or `memberId`
equal to the caller's own) is unchanged from before, ignores
`overridePhone`, and needs no finance-admin role.

setupSettlementAccount / requestSettlementChange / approveSettlementChange
create/change the Paystack subaccount + split code a chama's collections
settle into. Paybill and Till use Paystack Kenya's fixed codes (MPPAYBILL / MPTILL, from
GET /bank?country=kenya). Bank settlement uses the code of the bank the user
picked from listKenyaBanks, which returns banks only (never M-PESA, Paybill
or Till entries).
"""

from __future__ import annotations

import time

from firebase_functions import https_fn
from firebase_admin import firestore

from shared import firestore_paths as paths
from shared import ids
from shared import paystack
from shared.constants import PLANS, SECURITY, IntentPurposeCode
from shared.dates import now_ms
from shared.errors import bad_request, not_found, precondition, rate_limited, require_auth
from shared.idempotency import already_applied, record_result
from shared.money import contribution_fees, loan_repayment_fees, main_account_charge_subunits, mgr_contribution_fees
from shared.phone import detect_provider, is_valid_kenyan_phone, normalize_phone
from shared.roles import require_finance_admin, require_membership
from shared.secrets import PAYSTACK_SECRET_KEY
import requests

REGION = "africa-south1"

# Codes from Paystack's GET /bank?country=kenya (type mobile_money_business).
PAYBILL_BANK_CODE = "MPPAYBILL"
TILL_BANK_CODE = "MPTILL"
BANK_CODE_BY_TYPE = {"paybill": PAYBILL_BANK_CODE, "till": TILL_BANK_CODE}
# Paybill is NOT accepted for settlement for now: a Paybill payout needs an account reference that the
# subaccount API has no field for. A chama must settle to a bank account or a Till.
ENABLED_SETTLEMENT_TYPES = ("till", "bank")
# PAY's mychamaPayInitiate refuses to charge a chama unless settlementSplitKeyVersion == 2 (the split belongs to
# MyChama's own Paystack account), so every settlement account saved here must carry it.
SPLIT_KEY_VERSION = 2
# Never valid as a "bank": the M-PESA wallet, Paybill and Till entries in the same list.
MOBILE_MONEY_CODES = {"MPESA", PAYBILL_BANK_CODE, TILL_BANK_CODE}

_BANKS_TTL_SECONDS = 60 * 60
_banks_cache: dict = {"at": 0.0, "banks": []}


def _db():
    return firestore.client()


def _purpose_code(purpose: str) -> str:
    return {
        "contribution": IntentPurposeCode.CONTRIBUTION,
        "loan_repayment": IntentPurposeCode.LOAN_REPAYMENT,
        "mgr_contribution": IntentPurposeCode.MGR_CONTRIBUTION,
    }[purpose]


def _bank_code(account_type: str, explicit: str | None) -> str:
    if account_type == "paybill":
        raise precondition("M-Pesa Paybill settlement is currently under maintenance. Please use a bank account or a Till.")
    if account_type == "bank":
        if not explicit or explicit.upper() in MOBILE_MONEY_CODES:
            raise bad_request("Pick a bank for a bank settlement account.")
        return explicit
    if account_type not in BANK_CODE_BY_TYPE:
        raise bad_request("accountType must be paybill, till or bank.")
    return BANK_CODE_BY_TYPE[account_type]


def _kenya_banks(secret_key: str) -> list[dict]:
    """Kenyan banks only (name + code), alphabetical, cached for an hour. Excludes M-PESA, Paybill and Till."""
    if _banks_cache["banks"] and time.time() - _banks_cache["at"] < _BANKS_TTL_SECONDS:
        return _banks_cache["banks"]
    banks = [
        {"name": b["name"], "code": b["code"]}
        for b in paystack.list_banks(secret_key=secret_key, country="kenya")
        if b.get("name") and b.get("code")
        and b.get("active", True) and not b.get("is_deleted")
        and not str(b.get("type", "")).startswith("mobile_money")
        and str(b["code"]).upper() not in MOBILE_MONEY_CODES
    ]
    banks.sort(key=lambda b: b["name"].lower())
    _banks_cache.update(at=time.time(), banks=banks)
    return banks


@https_fn.on_call(region=REGION, secrets=[PAYSTACK_SECRET_KEY])
def listKenyaBanks(req: https_fn.CallableRequest) -> dict:
    require_auth(req)
    return {"banks": _kenya_banks(PAYSTACK_SECRET_KEY.value)}


def _create_split_with_bearer(*, secret_key: str, name: str, subaccount_code: str) -> dict:
    """POST /split with the subaccount as both the sole 100% share and the fee bearer.

    Paystack rejects bearer_type="subaccount" unless bearer_subaccount is also supplied
    ("Please provide bearer subaccount"), which is what shared.paystack.create_split was missing.
    Raises requests.HTTPError on a non-2xx response, same as the other Paystack helpers.
    """
    resp = requests.post(
        "https://api.paystack.co/split",
        json={
            "name": name,
            "type": "percentage",
            "currency": "KES",
            "subaccounts": [{"subaccount": subaccount_code, "share": 100}],
            "bearer_type": "subaccount",
            "bearer_subaccount": subaccount_code,
        },
        headers={"Authorization": f"Bearer {secret_key}"},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def _create_subaccount_and_split(*, secret_key: str, chama_name: str, account_type: str, account_number: str, bank_code: str) -> tuple[str, str]:
    """Returns (split_code, subaccount_code). Collections are charged against the subaccount code (see initiatePayment)."""
    sub = paystack.create_subaccount(
        secret_key=secret_key,
        business_name=chama_name,
        settlement_bank_code=bank_code,
        account_number=account_number,
    )
    subaccount_code = sub["data"]["subaccount_code"]
    split = _create_split_with_bearer(
        secret_key=secret_key,
        name=f"{chama_name} settlement",
        subaccount_code=subaccount_code,
    )
    return split["data"]["split_code"], subaccount_code


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
    if account_type not in ("paybill", "till", "bank") or not account_number:
        raise bad_request("accountType and accountNumber are required.")
    bank_code = _bank_code(account_type, data.get("bankCode"))

    split_code, subaccount_code = _create_subaccount_and_split(
        secret_key=PAYSTACK_SECRET_KEY.value,
        chama_name=chama.get("name", "Chama"),
        account_type=account_type,
        account_number=account_number,
        bank_code=bank_code,
    )

    chama_ref.update({
        "settlementAccount": f"{account_type}:{account_number}",
        "settlementSplitCode": split_code,
        "settlementSubaccountCode": subaccount_code,
        "settlementSplitKeyVersion": SPLIT_KEY_VERSION,
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
    _bank_code(account_type, data.get("bankCode"))   # rejects Paybill (maintenance) and a bank request without a real bank

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

    try:
        split_code, subaccount_code = _create_subaccount_and_split(
            secret_key=PAYSTACK_SECRET_KEY.value,
            chama_name=chama.get("name", "Chama"),
            account_type=request["accountType"],
            account_number=request["accountNumber"],
            bank_code=bank_code,
        )
    except requests.HTTPError as e:
        resp = e.response
        body = resp.text if resp is not None else ""
        url = resp.url if resp is not None else "unknown"
        status = resp.status_code if resp is not None else "?"
        print(f"Paystack error {status} on {url}: {body}")
        try:
            detail = resp.json().get("message", "Paystack request failed")
        except Exception:
            detail = "Paystack request failed"
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            f"Paystack ({status}): {detail}",
        )

    ts = now_ms()
    req_ref.update({"status": "approved", "approvedBy": membership.member_id, "updatedAt": ts})
    chama_ref.update({
        "settlementAccount": f"{request['accountType']}:{request['accountNumber']}",
        "settlementSplitCode": split_code,
        "settlementSubaccountCode": subaccount_code,
        "settlementSplitKeyVersion": SPLIT_KEY_VERSION,
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
    target_member_id = data.get("memberId")

    if not chama_id or purpose not in ("contribution", "loan_repayment", "mgr_contribution"):
        raise bad_request("chamaId and a valid purpose are required.")
    if not isinstance(amount, (int, float)) or amount <= 0:
        raise bad_request("amount must be a positive number.")

    db = _db()
    caller_membership = require_membership(db, uid, chama_id)

    phone_overridden = False
    member_phone_on_file = None
    if target_member_id and target_member_id != caller_membership.member_id:
        # Admin-initiated charge on behalf of another member. Only a
        # finance admin may do this. Defaults to the target member's own
        # phone on file; an explicit `overridePhone` from the finance admin
        # is allowed (see module docstring) but is always logged as an
        # override rather than silently treated as "the member's phone".
        require_finance_admin(db, uid, chama_id)
        target_snap = db.document(paths.member(chama_id, target_member_id)).get()
        if not target_snap.exists:
            raise not_found("Member not found.")
        target_member = target_snap.to_dict()
        if target_member.get("status") != "active":
            raise precondition("This member isn't active.")
        member_id = target_member_id
        member_phone_on_file = target_member.get("phone") or ""
        override_phone = (data.get("overridePhone") or "").strip()
        if override_phone:
            phone = override_phone
            phone_overridden = phone.strip() != member_phone_on_file.strip()
        else:
            phone = member_phone_on_file
        initiated_by = {"uid": uid, "memberId": caller_membership.member_id, "role": caller_membership.role}
    else:
        member_id = caller_membership.member_id
        phone = data.get("phone") or ""
        initiated_by = None

    if not is_valid_kenyan_phone(phone):
        raise bad_request("A valid Kenyan phone number is required.")

    chama_snap = db.document(paths.chama(chama_id)).get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()
    plan = chama.get("plan", "free")

    if not PLANS.get(plan, PLANS["free"])["onlineCollection"]:
        raise precondition("This chama's plan doesn't include online collections yet — pay in cash, or ask the chair to upgrade the plan.")
    if not chama.get("settlementSplitCode"):
        raise precondition("This chama hasn't set up a settlement account yet — ask the chair to set one up first.")
    if not chama.get("settlementSubaccountCode"):
        raise precondition("This chama's settlement account needs to be saved again before it can collect — ask the chair to re-enter it in Payments.")

    # Rate limit: MAX_INTENTS_PER_HOUR, keyed on whoever is actually being
    # charged (member_id) — not the caller — so an admin working down a
    # list of members doesn't share one bucket with everyone's self-pay
    # attempts, but also can't bypass a given member's own limit by being
    # the one to trigger it.
    one_hour_ago = now_ms() - 60 * 60 * 1000
    recent = list(
        db.collection(paths.payment_intents(chama_id))
        .where("memberId", "==", member_id)
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
        "memberId": member_id,
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
        "initiatedBy": initiated_by,
        "phoneOverridden": phone_overridden,
        "memberPhoneOnFile": member_phone_on_file,
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
            email=f"{member_id}@mychama.app",
            amount_kes=fee_calc["gross"],
            phone_e164=normalized_phone,
            provider=provider,
            reference=reference,
            # The chama's subaccount gets exactly the net amount: the main account keeps gross - net as a flat
            # charge (and bears Paystack's fee out of it), so the chama is never paid more or less than owed.
            subaccount=chama["settlementSubaccountCode"],
            transaction_charge_subunits=main_account_charge_subunits(fee_calc["gross"], fee_calc["net"]),
            metadata={
                "chargeType": "mychama_payment",
                "targetProject": "mychama1",
                "chamaId": chama_id,
                "memberId": member_id,
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