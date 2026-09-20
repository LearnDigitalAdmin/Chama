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
