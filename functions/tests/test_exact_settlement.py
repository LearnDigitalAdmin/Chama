"""A chama owed `net` is paid exactly `net`: the main account keeps gross - net, the subaccount gets the rest."""
import pytest

from shared import paystack
from shared.money import contribution_fees, loan_repayment_fees, main_account_charge_subunits, mgr_contribution_fees


def _cents(x: float) -> int:
    return round(x * 100)


@pytest.mark.parametrize("fees", [contribution_fees, mgr_contribution_fees, lambda n: loan_repayment_fees(n, "starter")])
def test_chama_receives_exactly_net_for_every_amount(fees):
    for net in [1, 2, 10, 33, 99.99, 100, 250.5, 1000, 1234.56, 5000, 49999.99, 100000, 250000]:
        f = fees(float(net))
        charge = main_account_charge_subunits(f["gross"], f["net"])
        assert _cents(f["gross"]) - charge == _cents(net)                    # subaccount share == net, to the cent
        assert charge >= _cents(f["paystackFee"]) - 1                         # main account covers Paystack's fee (rounding only)


def test_charge_payload_uses_subaccount_flat_charge_and_main_account_bearer(monkeypatch):
    sent = {}

    class R:
        def raise_for_status(self): pass
        def json(self): return {"status": True}

    monkeypatch.setattr(paystack.requests, "post", lambda url, json, headers, timeout: sent.update(json) or R())
    f = contribution_fees(100.0)
    paystack.charge_mobile_money(
        secret_key="sk", email="a@b.co", amount_kes=f["gross"], phone_e164="+254700000000", provider="mpesa",
        reference="r1", metadata={}, subaccount="ACCT_x", transaction_charge_subunits=main_account_charge_subunits(f["gross"], 100.0),
    )
    assert sent["subaccount"] == "ACCT_x" and sent["bearer"] == "account" and "split_code" not in sent
    assert sent["amount"] - sent["transaction_charge"] == 10000


def test_charge_rejects_split_code_with_subaccount_and_subaccount_without_charge():
    base = dict(secret_key="sk", email="a@b.co", amount_kes=10, phone_e164="+254700000000", provider="mpesa", reference="r", metadata={})
    with pytest.raises(ValueError):
        paystack.charge_mobile_money(**base, split_code="SPL_1", subaccount="ACCT_x", transaction_charge_subunits=100)
    with pytest.raises(ValueError):
        paystack.charge_mobile_money(**base, subaccount="ACCT_x")


def test_desk_commission_charges_still_use_split_code_only(monkeypatch):
    """SMS top-ups, plan billing and reports carry the desk's split_code; none of them may gain a subaccount/flat charge."""
    sent = {}

    class R:
        def raise_for_status(self): pass
        def json(self): return {"status": True}

    monkeypatch.setattr(paystack.requests, "post", lambda url, json, headers, timeout: sent.update(json) or R())
    paystack.charge_mobile_money(
        secret_key="sk", email="a@b.co", amount_kes=500, phone_e164="+254700000000", provider="mpesa",
        reference="MCS-1", metadata={}, split_code="SPL_desk",
    )
    assert sent["split_code"] == "SPL_desk"
    assert not {"subaccount", "transaction_charge", "bearer"} & sent.keys()
