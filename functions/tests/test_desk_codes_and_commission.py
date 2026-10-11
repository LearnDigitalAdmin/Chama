import inspect
import pytest
from firebase_functions import https_fn

from fakes import FakeDB
from mychama import desk_commission as dc
from shared import desk_codes as codes

CFG = {
    "creditCostMinor": 20, "expectedPaystackFeePct": 1.5, "smsShareOfMarginPct": 40, "firstPurchaseThresholdMinor": 20000,
    "subShareByRank": {"clerk": 25, "senior": 30, "lead": 30}, "reportShareByRank": {"clerk": 25, "senior": 30, "lead": 30}, "updatedAt": 1,
}
OWNER = {"agentCode": "COG-0007", "subaccountCode": "ACCT_abc123", "rank": "senior", "updatedAt": 1}


# ---------------------------------------------------------------- public codes
def test_public_codes_are_sequential_unique_and_stable():
    db = FakeDB({"chamas/a": {"name": "A"}, "chamas/b": {"name": "B"}})
    a = codes.allocate_for_existing_chama(db, "a")
    b = codes.allocate_for_existing_chama(db, "b")
    assert (a, b) == ("SMC-0001", "SMC-0002")
    assert codes.allocate_for_existing_chama(db, "a") == "SMC-0001"          # idempotent backfill
    assert db.store["chamas/a"]["publicCode"] == "SMC-0001"
    assert codes.resolve_chama_id(db, "smc-0002") == "b"
    assert codes.resolve_chama_id(db, "SMC-0099") is None


def test_codes_grow_past_five_digits_and_keep_four_digit_minimum():
    assert codes.format_public_code(7) == "SMC-0007"
    assert codes.format_public_code(99999) == "SMC-99999"
    assert codes.format_public_code(123456) == "SMC-123456"
    assert codes.PUBLIC_CODE_RE.match("SMC-123456") and not codes.PUBLIC_CODE_RE.match("SMC-123")


def test_reserved_code_is_never_overwritten():
    db = FakeDB({"chamas/a": {}, "deskCounters/chamaPublicCode": {"last": 0}, "publicCodes/SMC-0001": {"chamaId": "x"}})
    with pytest.raises(RuntimeError):
        codes.allocate_for_existing_chama(db, "a")


def test_resolve_requires_the_chama_to_still_carry_the_code():
    db = FakeDB({"publicCodes/SMC-0001": {"chamaId": "a"}, "chamas/a": {"publicCode": "SMC-0009"}})
    assert codes.resolve_chama_id(db, "SMC-0001") is None


# ---------------------------------------------------------------- commissions
def test_no_owner_or_no_config_means_no_split():
    db = FakeDB({"desk_public_config/global": CFG})
    assert dc.prepare_split(db, "sk", {}, dc.KIND_SUBSCRIPTION, 999) is None
    db2 = FakeDB()
    assert dc.prepare_split(db2, "sk", {"deskOwner": OWNER}, dc.KIND_SUBSCRIPTION, 999) is None


def test_top_desk_or_malformed_owner_never_earns():
    db = FakeDB({"desk_public_config/global": CFG})
    for bad in ({**OWNER, "agentCode": "COG-0000"}, {**OWNER, "subaccountCode": ""}, {**OWNER, "rank": "boss"}, "x"):
        assert dc.prepare_split(db, "sk", {"deskOwner": bad}, dc.KIND_SUBSCRIPTION, 999) is None


def test_subscription_splits_to_agents_subaccount_and_records_commission(monkeypatch):
    calls = []

    def fake_split(**kw):
        calls.append(kw)
        return {"status": True, "data": {"split_code": "SPL_1"}}

    monkeypatch.setattr(dc.paystack, "create_commission_split", fake_split)
    db = FakeDB({"desk_public_config/global": CFG})
    p = dc.prepare_split(db, "sk", {"deskOwner": OWNER}, dc.KIND_SUBSCRIPTION, 2499)
    assert p.split_code == "SPL_1"
    assert p.desk_commission == {"agentCode": "COG-0007", "sharePct": 30, "rule": "subscription"}
    assert calls == [{"secret_key": "sk", "name": "Desk ACCT_abc123 30%", "subaccount_code": "ACCT_abc123", "share_pct": 30}]
    # cached: a second charge at the same share makes no second Paystack call
    assert dc.prepare_split(db, "sk", {"deskOwner": OWNER}, dc.KIND_SUBSCRIPTION, 999).split_code == "SPL_1"
    assert len(calls) == 1


def test_report_share_and_sms_margin_share(monkeypatch):
    monkeypatch.setattr(dc.paystack, "create_commission_split", lambda **kw: {"status": True, "data": {"split_code": f"S{kw['share_pct']}"}})
    db = FakeDB({"desk_public_config/global": CFG})
    clerk = {**OWNER, "rank": "clerk"}
    assert dc.prepare_split(db, "sk", {"deskOwner": clerk}, dc.KIND_REPORT, 504).desk_commission["sharePct"] == 25
    sms = dc.prepare_split(db, "sk", {"deskOwner": clerk}, dc.KIND_SMS, 500).desk_commission
    assert sms["rule"] == "sms_standard" and 0 < sms["sharePct"] <= 40


def test_paystack_failure_refuses_the_charge(monkeypatch):
    def boom(**kw):
        raise RuntimeError("down")

    monkeypatch.setattr(dc.paystack, "create_commission_split", boom)
    db = FakeDB({"desk_public_config/global": CFG})
    with pytest.raises(https_fn.HttpsError) as e:
        dc.prepare_split(db, "sk", {"deskOwner": OWNER}, dc.KIND_SUBSCRIPTION, 999)
    assert e.value.code == "unavailable"


def test_unusable_config_charges_without_a_split():
    db = FakeDB({"desk_public_config/global": {"creditCostMinor": 20}})
    assert dc.prepare_split(db, "sk", {"deskOwner": OWNER}, dc.KIND_SUBSCRIPTION, 999) is None


def test_commission_kinds_match_the_charges_that_use_them():
    # MCP- plan billing, MCX-/MCR- report credits, MCS- SMS credits all call prepare_split; contributions/loans/MGR do not.
    import mychama.billing as b, mychama.sms as s, mychama.reports as r, mychama.payments as p
    assert "desk_commission.KIND_SUBSCRIPTION" in inspect.getsource(b.upgradePlan.__wrapped__) or "KIND_SUBSCRIPTION" in inspect.getsource(b)
    assert "KIND_SMS" in inspect.getsource(s)
    assert inspect.getsource(r).count("KIND_REPORT") == 2
    assert "desk_commission" not in inspect.getsource(p)
