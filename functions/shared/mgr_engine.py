"""
NEW IN PHASE 2 — Merry-Go-Round engine.

Not present in the WhatsApp bot (it only reads pots, never draws or closes
them) — ported faithfully from the attached demo's JS (mgrLateScore,
mgrRecentReliability, mgrRunDraw, mgrPoolForRound). Mirrored read-only in
src/lib/mgrEngine.ts for the frontend to render "% on-time" and similar
display-only figures; the WRITE path (the draw itself, closing a period)
only ever runs here, inside the callables in mychama/mgr.py, so there is
exactly one place that can reorder a payout queue.

Design intent (from the demo's comments, preserved because it explains
choices that aren't obvious from the code alone):
  - Every missed contribution adds 1 to a member's "late score"; every
    period paid afterward decays the score by 30% (multiply by 0.7). This
    means a member who had a rough patch but has since paid consistently
    drifts back toward the front of the queue instead of being punished
    forever for a couple of early misses.
  - The lottery draw is a Fisher-Yates shuffle first (so who's "ahead" of
    whom within the same reliability tier is genuinely random), THEN a
    stable sort by late score (so reliability tiers are respected without
    destroying the within-tier randomness).
  - A round's payout pool is always the FULL EXPECTED amount
    (amount × members × periodsPerRound) — never scaled down by who
    actually paid — because a merry-go-round promises a fixed payout to
    whoever's turn it is. A shortfall is surfaced to admins to chase, not
    quietly passed on to the recipient.

MGR audit re-check (focused pass over just this module): build_final_plan
now actually branches on the pot's finalRoundPolicy — previously every
policy paid identically (a reduced, evenly-split share of whatever was
left), which meant choosing "carry over" or "close out" at pot creation
changed the UI's copy but nothing about the money. See build_final_plan's
own docstring for what each policy does now.
"""

from __future__ import annotations

import random
from typing import TypedDict


LATE_DECAY = 0.7


def late_score(records: list[dict], member_id: str) -> float:
    """records: this pot's full records list (any period). Sorted by period
    ascending internally so the decay walk is chronological."""
    recs = sorted(
        [r for r in records if r["memberId"] == member_id],
        key=lambda r: r["period"],
    )
    score = 0.0
    for r in recs:
        score = score + 1 if r["status"] == "missed" else score * LATE_DECAY
    return round(score * 100) / 100


def paid_count(records: list[dict], member_id: str) -> int:
    return sum(1 for r in records if r["memberId"] == member_id and r["status"] == "paid")


def missed_count(records: list[dict], member_id: str) -> int:
    return sum(1 for r in records if r["memberId"] == member_id and r["status"] == "missed")


def reliability(records: list[dict], member_id: str) -> int:
    paid = paid_count(records, member_id)
    missed = missed_count(records, member_id)
    total = paid + missed
    return 100 if total == 0 else round(100 * paid / total)


def recent_reliability(records: list[dict], member_id: str, window: int = 10) -> int:
    recs = sorted(
        [r for r in records if r["memberId"] == member_id],
        key=lambda r: r["period"],
    )[-window:]
    if not recs:
        return 100
    return round(100 * sum(1 for r in recs if r["status"] == "paid") / len(recs))


def run_draw(records: list[dict], pool: list[str], method: str) -> list[str]:
    """pool: member IDs to order (all members for a first draw, or the
    remaining queue for a re-draw). Returns the new queue order."""
    shuffled = pool[:]
    random.shuffle(shuffled)

    if method != "smart":
        return shuffled

    # Stable sort by late score — ties keep the shuffled (random) order.
    scored = [(late_score(records, m), idx, m) for idx, m in enumerate(shuffled)]
    scored.sort(key=lambda t: (t[0], t[1]))
    return [m for _, _, m in scored]


class RoundInfo(TypedDict):
    periodsThisRound: list[int]
    expected: float
    actual: float
    shortfall: float


def pool_for_round(pot: dict, records: list[dict]) -> RoundInfo:
    period = pot["period"]
    periods_per_round = pot["periodsPerRound"]
    periods_this_round = list(range(period - periods_per_round + 1, period + 1))
    expected = pot["amount"] * len(pot["memberIds"]) * periods_per_round
    actual = sum(
        r["amount"] for r in records if r["period"] in periods_this_round and r["status"] == "paid"
    )
    shortfall = max(0.0, round((expected - actual) * 100) / 100)
    return RoundInfo(periodsThisRound=periods_this_round, expected=expected, actual=actual, shortfall=shortfall)


def pool_estimate(pot: dict) -> float:
    return pot["amount"] * len(pot["memberIds"]) * pot["periodsPerRound"]


def is_short_round(pot: dict) -> bool:
    """True once the queue can no longer fill a full round of recipients —
    e.g. members exited mid-cycle. Ported from the demo's mgrIsShortRound;
    a short round needs build_final_plan instead of the normal equal split."""
    return 0 < len(pot["queue"]) < pot["recipientsPerRound"]


def build_final_plan(pot: dict, records: list[dict], policy: str = "split") -> dict:
    """
    For a round that can't fill its normal recipient count (membership
    shrank via exits/removals mid-cycle): decides what the remaining
    queue actually gets paid. `policy` is the pot's `finalRoundPolicy`,
    chosen at creation (MGR audit re-check: this used to be stored and
    shown in the UI but never actually consulted here — every policy
    behaved like "split". Fixed below.):

      "split"      — divide whatever pool actually exists evenly across
                     whoever is left, same as before. A member who ends up
                     the sole survivor of a shrunk pot gets the whole
                     remaining pool, not a "full share" they didn't
                     collectively fund.

      "carry_over" / "close_early" — pay the SAME full standard share
                     every earlier recipient in this pot got (mirrors the
                     demo's mgrRoundShare comment: "the last member in the
                     queue is never short-changed"), funded first by
                     whatever's actually been collected. Any gap between
                     that full share and what's been collected still
                     surfaces as a normal poolShortfall — chased via
                     mgrCoverShortfall exactly like any other round,
                     never invented or silently absorbed by the
                     recipient. recordMgrPayoutCash tells "carry_over"
                     and "close_early" apart only in what happens to the
                     pot AFTER this payout (a fresh cycle starts
                     automatically for carry_over; the pot rests
                     'completed' for close_early, same as "split") — the
                     payout math itself is identical for both, which is
                     why they share this branch.

    Read-only projection — the actual payout still goes through
    recordMgrPayoutCash, which re-derives the same numbers itself rather
    than trusting a client-cached plan.
    """
    info = pool_for_round(pot, records)
    remaining = pot["queue"]
    if not remaining:
        return {"recipients": [], "shareEach": 0.0, "poolExpected": info["expected"], "poolShortfall": info["shortfall"], "policy": policy}

    if policy in ("carry_over", "close_early"):
        standard_share = round((pool_estimate(pot) / max(1, pot["recipientsPerRound"])) * 100) / 100
        required = round((standard_share * len(remaining)) * 100) / 100
        shortfall = max(0.0, round((required - info["actual"]) * 100) / 100)
        return {
            "recipients": remaining,
            "shareEach": standard_share,
            "poolExpected": required,
            "poolShortfall": shortfall,
            "policy": policy,
            "short": True,
        }

    share = round((info["expected"] / len(remaining)) * 100) / 100
    return {
        "recipients": remaining,
        "shareEach": share,
        "poolExpected": info["expected"],
        "poolShortfall": info["shortfall"],
        "policy": "split",
        "short": True,
    }


def health_check(pot: dict, records: list[dict], payouts: list[dict], arrears: list[dict]) -> list[dict]:
    """
    Pure diagnostics, no writes — safe to run client-side too (mirrored in
    src/lib/mgrEngine.ts) for an instant Health card. Only mgrRepairPot
    (server-only) may act on what this finds. Each finding:
    {code, message, memberId?}.
    """
    findings: list[dict] = []
    member_set = set(pot["memberIds"])
    queue_set = set(pot["queue"])

    dup_ids = {m for m in pot["queue"] if pot["queue"].count(m) > 1}
    for m in dup_ids:
        findings.append({"code": "duplicate_in_queue", "memberId": m, "message": "Appears more than once in the payout queue."})

    for m in queue_set - member_set:
        findings.append({"code": "orphaned_in_queue", "memberId": m, "message": "In the payout queue but no longer a pot member."})

    for m in member_set - queue_set:
        if pot["status"] == "active":
            findings.append({"code": "missing_from_queue", "memberId": m, "message": "A pot member with no place in the payout queue."})

    open_arrear_ids = {a["memberId"] for a in arrears if a.get("status") == "open"}
    for m in open_arrear_ids - member_set:
        findings.append({"code": "arrear_for_ex_member", "memberId": m, "message": "Has an open arrear but is no longer a pot member — settle or write off before closing the pot."})

    if pot.get("pendingShortfall", 0) > 0:
        findings.append({"code": "uncovered_shortfall", "message": f"KES {pot['pendingShortfall']:,.2f} of the last completed round was never covered."})

    if is_short_round(pot) and pot["status"] == "active":
        findings.append({"code": "short_round", "message": "Fewer members remain than a full round needs — the next payout will use a final settlement plan."})

    return findings
