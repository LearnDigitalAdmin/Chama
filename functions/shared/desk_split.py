"""
Desk commission math — a faithful Python port of the desk kernel's `sharePlan` and `smsPlan`
(CYBER functions-desk/src/money.ts) so MyChama builds exactly the same Paystack percentage split the
desk would compute. Pure functions, integer minor units (KES x 100) for every amount.

Differences from the desk kernel, by design (see the W2-A brief):
  * no first-purchase rule for MyChama (the 100%-of-margin case exists only for Register / Plot Yangu);
  * only the inputs MyChama needs: rank shares and the SMS margin share, read from the document
    `desk_public_config/global` that desk keeps current in this project.

Every function here must stay value-identical to money.ts; tests/test_desk_split.py replays the vectors
of functions-desk/src/money.test.ts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping

RANKS = ("clerk", "senior", "lead")


class DeskConfigError(ValueError):
    """desk_public_config/global is missing or malformed — no commission split may be built from it."""


@dataclass(frozen=True)
class SplitPlan:
    agent_share_pct: float
    rule: str


@dataclass(frozen=True)
class DeskRates:
    credit_cost_minor: int
    expected_paystack_fee_pct: float
    sms_share_of_margin_pct: float
    sub_share_by_rank: Mapping[str, float]
    report_share_by_rank: Mapping[str, float]


def _num(d: Mapping[str, Any], key: str, lo: float = 0.0, hi: float = 100.0) -> float:
    v = d.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < lo or v > hi:
        raise DeskConfigError(f"desk_public_config.{key} is missing or out of range")
    return float(v)


def parse_rates(raw: Mapping[str, Any] | None) -> DeskRates:
    """Validates the stored document (DeskPublicConfig in contract.ts). Raises DeskConfigError if unusable."""
    if not isinstance(raw, Mapping):
        raise DeskConfigError("desk_public_config/global does not exist")
    cost = raw.get("creditCostMinor")
    if isinstance(cost, bool) or not isinstance(cost, int) or cost < 0:
        raise DeskConfigError("desk_public_config.creditCostMinor must be a non-negative integer")

    def ranks(key: str) -> dict[str, float]:
        block = raw.get(key)
        if not isinstance(block, Mapping):
            raise DeskConfigError(f"desk_public_config.{key} is missing")
        return {r: _num(block, r) for r in RANKS}

    return DeskRates(
        credit_cost_minor=cost,
        expected_paystack_fee_pct=_num(raw, "expectedPaystackFeePct", 0.0, 50.0),
        sms_share_of_margin_pct=_num(raw, "smsShareOfMarginPct"),
        sub_share_by_rank=ranks("subShareByRank"),
        report_share_by_rank=ranks("reportShareByRank"),
    )


def to_bps(pct: float) -> int:
    """97.5 -> 9750. JS Math.round semantics (half up), not Python's banker's rounding."""
    return int(math.floor(pct * 100 + 0.5))


def floor_pct2(pct: float) -> float:
    """Never overpay an agent: round DOWN to 0.01%. The epsilon guards binary-float artefacts (71.03 * 100)."""
    return math.floor(pct * 100 + 1e-9) / 100


def _assert_minor(n: int, label: str) -> None:
    if isinstance(n, bool) or not isinstance(n, int) or n < 0:
        raise ValueError(f"{label} must be a non-negative integer minor unit, got {n!r}")


def share_plan(rank: str, kind: str, rates: DeskRates) -> SplitPlan:
    """Subscriptions and reports: the agent's share is fixed by rank. kind is 'subscription' or 'report'."""
    if kind == "subscription":
        table = rates.sub_share_by_rank
    elif kind == "report":
        table = rates.report_share_by_rank
    else:
        raise ValueError(f"unknown share kind {kind!r}")
    if rank not in table:
        raise DeskConfigError(f"unknown desk rank {rank!r}")
    return SplitPlan(floor_pct2(table[rank]), kind)


def credits_for(gross_minor: int, rate_per_credit_minor: int) -> int:
    if rate_per_credit_minor <= 0:
        raise ValueError("rate must be positive")
    return gross_minor // rate_per_credit_minor


def sms_plan(gross_minor: int, credits: int, rates: DeskRates) -> SplitPlan:
    """
    SMS credit purchases: the agent targets 40% (configured) of the margin
    s * (gross - fee - creditCost). With proportional fee bearing the agent nets a * (gross - fee), so
    a = s * (1 - cost / (gross - fee)). No first-purchase rule for MyChama.
    """
    _assert_minor(gross_minor, "gross")
    _assert_minor(credits, "credits")
    expected_fee = int(math.floor(gross_minor * rates.expected_paystack_fee_pct / 100 + 0.5))
    base = gross_minor - expected_fee
    cost = credits * rates.credit_cost_minor
    if base <= cost:
        return SplitPlan(0.0, "no_margin")
    s = rates.sms_share_of_margin_pct / 100
    return SplitPlan(floor_pct2(s * (1 - cost / base) * 100), "sms_standard")


def settled_amounts(gross_minor: int, fee_minor: int, agent_share_pct: float) -> dict[str, int]:
    """What a confirmed charge paid each side (used by tests to check conservation; PAY records the real event)."""
    _assert_minor(gross_minor, "gross")
    _assert_minor(fee_minor, "fee")
    if fee_minor > gross_minor:
        raise ValueError("fee exceeds gross")
    net = gross_minor - fee_minor
    agent = (net * to_bps(agent_share_pct)) // 10000
    return {"netMinor": net, "agentMinor": agent, "platformMinor": net - agent}
