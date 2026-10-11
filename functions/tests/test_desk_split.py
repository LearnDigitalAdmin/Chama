"""Replays functions-desk/src/money.test.ts (CYBER) against the Python port, with the same default config."""
import os, sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from shared import desk_split as ds  # noqa: E402

# DEFAULT_DESK_CONFIG of the desk kernel — the values desk_public_config/global carries.
RAW = {
    "creditCostMinor": 20, "expectedPaystackFeePct": 1.5, "smsShareOfMarginPct": 40, "firstPurchaseThresholdMinor": 20000,
    "subShareByRank": {"clerk": 25, "senior": 30, "lead": 30},
    "reportShareByRank": {"clerk": 25, "senior": 30, "lead": 30}, "updatedAt": 1,
}
R = ds.parse_rates(RAW)


def test_subscription_and_report_shares_by_rank():
    assert ds.share_plan("senior", "subscription", R).agent_share_pct == 30
    assert ds.share_plan("clerk", "report", R).agent_share_pct == 25
    s = ds.settled_amounts(99900, 1499, 30)
    assert s["netMinor"] == 98401 and s["agentMinor"] == 29520


def test_sms_standard_purchase_kes_500_at_070():
    credits = ds.credits_for(50000, 70)
    p = ds.sms_plan(50000, credits, R)
    assert p.rule == "sms_standard"
    s = ds.settled_amounts(50000, 750, p.agent_share_pct)
    target = int(0.4 * (50000 - 750 - credits * 20))  # 13988
    assert abs(s["agentMinor"] - target) <= 2


def test_sms_at_or_above_threshold_never_uses_first_purchase_rule():
    # MyChama has no first-purchase rule: a KES 150 purchase still earns the standard 40% of margin
    credits = ds.credits_for(15000, 70)
    assert credits == 214
    p = ds.sms_plan(15000, credits, R)
    assert p.rule == "sms_standard" and p.agent_share_pct <= 40


def test_sms_no_margin_means_no_share():
    assert ds.sms_plan(1000, 100, R) == ds.SplitPlan(0.0, "no_margin")


def test_floor_pct2_survives_float_artefacts():
    assert ds.floor_pct2(71.03) == 71.03
    assert ds.floor_pct2(0.375) == 0.37


def test_conservation_for_pseudo_random_charges():
    seed = 4242
    for _ in range(3000):
        seed = (seed * 1103515245 + 12345) % 2147483648
        r1 = seed / 2147483648
        seed = (seed * 1103515245 + 12345) % 2147483648
        r2 = seed / 2147483648
        seed = (seed * 1103515245 + 12345) % 2147483648
        r3 = seed / 2147483648
        gross = 100 + int(r1 * 500000)
        fee = int(gross * (0.005 + r2 * 0.03))
        share = ds.floor_pct2(r3 * 99)
        s = ds.settled_amounts(gross, fee, share)
        assert s["agentMinor"] + s["platformMinor"] == s["netMinor"]
        assert s["agentMinor"] >= 0 and s["platformMinor"] >= 0


def test_sms_share_never_exceeds_ceiling_or_goes_negative():
    for g in range(3000, 500001, 1777):
        for rate in (90, 75, 70, 60, 50, 40):
            p = ds.sms_plan(g, ds.credits_for(g, rate), R)
            assert 0 <= p.agent_share_pct <= 40


@pytest.mark.parametrize("bad", [None, {}, {**RAW, "creditCostMinor": -1}, {**RAW, "subShareByRank": {"clerk": 25}},
                                  {**RAW, "smsShareOfMarginPct": 140}, {**RAW, "expectedPaystackFeePct": "1.5"}])
def test_malformed_public_config_is_refused(bad):
    with pytest.raises(ds.DeskConfigError):
        ds.parse_rates(bad)


def test_unknown_rank_is_refused():
    with pytest.raises(ds.DeskConfigError):
        ds.share_plan("boss", "subscription", R)
