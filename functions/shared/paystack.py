"""
Paystack helper for mychama1's own Python functions.

MyChama's own Paystack secret key (Secret Manager — see functions/main.py's
secret binding), separate from the PAY repo's keys. The PAY repo's webhook
is still the SINGLE place that ever marks a payment as received (see
docs/ARCHITECTURE.md §1-2); this module only ever INITIATES charges/
subaccounts, never applies their result — that stays the webhook's job,
keeping the single-writer rule intact even though the initiating call now
happens from two different codebases (this one, and CYBER's bot).

Endpoint shapes here mirror the PAY repo's own Paystack calls
(functions/src/index.ts — chargeCustomer / setupAccount /
getOrCreateSplitCode) so a MyChama charge looks structurally identical to
every other product's charge from Paystack's and the webhook's point of
view. Verify against that file if Paystack's API surface has moved on.
"""

from __future__ import annotations

import requests

PAYSTACK_API_BASE = "https://api.paystack.co"


def _headers(secret_key: str) -> dict:
    return {"Authorization": f"Bearer {secret_key}", "Content-Type": "application/json"}


def charge_mobile_money(
    *,
    secret_key: str,
    email: str,
    amount_kes: float,
    phone_e164: str,
    provider: str,
    reference: str,
    metadata: dict,
    split_code: str | None = None,
    subaccount: str | None = None,
    transaction_charge_subunits: int | None = None,
) -> dict:
    """
    Initiates an STK push. With `subaccount` + `transaction_charge_subunits`, Paystack keeps that flat amount
    in the main account (which also bears Paystack's fee, bearer "account") and pays the subaccount the rest —
    so a chama's settlement is exactly gross - transaction_charge. A charge takes a split_code OR a subaccount, never both. `split_code` (a Paystack percentage split in THIS account, see
    create_commission_split) is attached when a desk commission applies — the same mechanism PAY's
    chargeCustomer uses. Returns Paystack's response body — the caller
    stores its `data.status`/`data.display_text` on the paymentIntent for
    troubleshooting, but must NOT treat this response as confirmation of
    payment: only the PAY repo's webhook (on charge.success) does that.
    """
    payload = {
        "email": email,
        "amount": round(amount_kes * 100),  # smallest currency unit
        "currency": "KES",
        "mobile_money": {"phone": phone_e164, "provider": provider},
        "reference": reference,
        "metadata": metadata,
    }
    if split_code and subaccount:
        raise ValueError("A charge takes a split_code or a subaccount, not both.")
    if split_code:
        payload["split_code"] = split_code
    if subaccount:
        if transaction_charge_subunits is None or transaction_charge_subunits < 0:
            raise ValueError("transaction_charge_subunits is required with a subaccount.")
        payload["subaccount"] = subaccount
        payload["transaction_charge"] = int(transaction_charge_subunits)
        payload["bearer"] = "account"
    resp = requests.post(f"{PAYSTACK_API_BASE}/charge", json=payload, headers=_headers(secret_key), timeout=20)
    resp.raise_for_status()
    return resp.json()


def create_subaccount(
    *,
    secret_key: str,
    business_name: str,
    settlement_bank_code: str,
    account_number: str,
    percentage_charge: float = 0,
) -> dict:
    """Creates a Paystack subaccount for a chama's settlement destination."""
    # Paystack's docs name this field both `bank_code` and `settlement_bank`; both are sent because that exact
    # request was accepted in test mode for M-PESA Till (MPTILL) and M-PESA Paybill (MPPAYBILL) subaccounts.
    payload = {
        "business_name": business_name,
        "bank_code": settlement_bank_code,
        "settlement_bank": settlement_bank_code,
        "account_number": account_number,
        "percentage_charge": percentage_charge,
    }
    resp = requests.post(f"{PAYSTACK_API_BASE}/subaccount", json=payload, headers=_headers(secret_key), timeout=20)
    resp.raise_for_status()
    return resp.json()


def list_banks(*, secret_key: str, country: str = "kenya") -> list[dict]:
    """Paystack's bank list for a country (first page, up to 100 entries)."""
    resp = requests.get(
        f"{PAYSTACK_API_BASE}/bank",
        params={"country": country, "perPage": 100},
        headers=_headers(secret_key),
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def create_split(
    *,
    secret_key: str,
    name: str,
    subaccount_code: str,
    bearer_type: str = "subaccount",
) -> dict:
    """
    Creates a 100%-to-subaccount split code — the chama receives the net
    amount after Paystack's own fee; MyChama's markup fee
    (functions/shared/money.py) is already baked into what the member was
    CHARGED (gross_up_for_fees), not taken out of this split.

    Paystack requires `bearer_subaccount` whenever bearer_type is "subaccount"
    (otherwise: 400 "Please provide bearer subaccount").
    """
    payload = {
        "name": name,
        "type": "percentage",
        "currency": "KES",
        "subaccounts": [{"subaccount": subaccount_code, "share": 100}],
        "bearer_type": bearer_type,
    }
    if bearer_type == "subaccount":
        payload["bearer_subaccount"] = subaccount_code
    resp = requests.post(f"{PAYSTACK_API_BASE}/split", json=payload, headers=_headers(secret_key), timeout=20)
    resp.raise_for_status()
    return resp.json()


def resolve_account_number(*, secret_key: str, account_number: str, bank_code: str) -> dict:
    """Verifies a bank/paybill account number resolves to a real account before creating a subaccount for it."""
    resp = requests.get(
        f"{PAYSTACK_API_BASE}/bank/resolve",
        params={"account_number": account_number, "bank_code": bank_code},
        headers=_headers(secret_key),
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def create_commission_split(*, secret_key: str, name: str, subaccount_code: str, share_pct: float) -> dict:
    """
    A desk commission split: ONE subaccount (the desk agent's, in MyChama's own Paystack account) gets
    `share_pct` of (gross - Paystack's real fee); the remainder stays with MyChama's account.
    bearer_type "all-proportional" makes Paystack deduct its fee proportionally — the model PAY's
    getOrCreateSplitCode uses (functions/src/index.ts) and the desk kernel documents.
    """
    payload = {
        "name": name,
        "type": "percentage",
        "currency": "KES",
        "subaccounts": [{"subaccount": subaccount_code, "share": share_pct}],
        "bearer_type": "all-proportional",
    }
    resp = requests.post(f"{PAYSTACK_API_BASE}/split", json=payload, headers=_headers(secret_key), timeout=20)
    resp.raise_for_status()
    return resp.json()