"""Settlement account codes: Till/Paybill use fixed Paystack codes; the bank list excludes M-PESA entries."""
import pytest
from firebase_functions import https_fn

from mychama import payments


def _reset_cache():
    payments._banks_cache.update(at=0.0, banks=[])


def test_till_uses_its_fixed_code_and_paybill_is_refused():
    assert payments._bank_code("till", None) == "MPTILL"
    with pytest.raises(https_fn.HttpsError) as e:
        payments._bank_code("paybill", None)
    assert "maintenance" in e.value.message


def test_bank_needs_a_real_bank_code():
    assert payments._bank_code("bank", "063") == "063"
    for bad in (None, "", "MPTILL", "mppaybill", "MPESA"):
        with pytest.raises(https_fn.HttpsError):
            payments._bank_code("bank", bad)
    with pytest.raises(https_fn.HttpsError):
        payments._bank_code("sacco", None)


def test_kenya_bank_list_is_banks_only_sorted_and_cached(monkeypatch):
    _reset_cache()
    calls = []
    raw = [
        {"name": "Zeta Bank", "code": "99", "type": "kepss", "active": True},
        {"name": "M-PESA", "code": "MPESA", "type": "mobile_money"},
        {"name": "M-PESA Paybill", "code": "MPPAYBILL", "type": "mobile_money_business"},
        {"name": "M-PESA Till", "code": "MPTILL", "type": "mobile_money_business"},
        {"name": "Alpha Bank", "code": "01", "type": "kepss", "active": True},
        {"name": "Old Bank", "code": "02", "type": "kepss", "is_deleted": True},
    ]
    monkeypatch.setattr(payments.paystack, "list_banks", lambda **kw: calls.append(kw) or raw)
    assert payments._kenya_banks("sk") == [{"name": "Alpha Bank", "code": "01"}, {"name": "Zeta Bank", "code": "99"}]
    payments._kenya_banks("sk")
    assert len(calls) == 1
    _reset_cache()
