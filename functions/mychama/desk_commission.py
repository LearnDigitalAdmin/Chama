"""
Desk commissions at charge time (W2-A).

For every platform charge MyChama itself initiates — plan billing (MCP-), report credits / à la carte
(MCX- / MCR-), SMS credits (MCS-); NOT contributions, loans or MGR — when the chama is owned by a desk
(`chamas/{id}.deskOwner.subaccountCode`) and desk keeps `desk_public_config/global` in this project, the charge
carries a Paystack percentage split (bearer_type "all-proportional") in MyChama's OWN Paystack account paying
`sharePct` of (gross - real fee) to the agent's subaccount in that account.

This module only DECIDES and PREPARES the split. It records `deskCommission: {agentCode, sharePct, rule}`
(returned to the caller to store on the intent) — PAY's MyChama webhook turns that into the `desk_events` row;
nothing here writes an event, and nothing here calls into desk (access is one-way: desk reaches MyChama).

Failure policy: a missing/unusable desk setup means "no split" (logged, the customer's payment is never blocked
by desk's configuration). If a split IS due but Paystack cannot create it, the charge is refused with a
retryable error — silently dropping a contractual commission would be worse than asking the customer to retry.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from firebase_admin import firestore

from shared import desk_split as ds
from shared import paystack
from shared.dates import now_ms
from shared.desk_codes import AGENT_CODE_RE, TOP_DESK_CODE
from shared.errors import upstream_failure

PUBLIC_CONFIG_DOC = "desk_public_config/global"
SPLIT_CACHE_COLLECTION = "deskSplitCodes"

KIND_SUBSCRIPTION = "subscription"   # MCP-
KIND_REPORT = "report"               # MCX- and MCR-
KIND_SMS = "sms"                     # MCS-

_SUBACCOUNT_RE = re.compile(r"^ACCT_[A-Za-z0-9]+$")


@dataclass(frozen=True)
class PreparedSplit:
    split_code: str
    desk_commission: dict[str, Any]


def to_minor(amount_kes: float) -> int:
    """KES (float, as the intents store it) -> integer minor units."""
    return int(round(float(amount_kes) * 100))


def sms_credits_granted(gross_minor: int) -> int:
    """
    Credits an MCS- top-up grants. PAY's webhook (handleMyChamaSmsTopup in LearnDigitalAdmin/PAY,
    functions/src/mychama/webhook/handlers.ts) credits `chamas.smsCredits += topup.amountKes`, i.e. one
    credit per whole KES paid; this mirrors it so the SMS margin is computed on what is really delivered.
    """
    return gross_minor // 100


def _valid_owner(owner: Any) -> dict[str, Any] | None:
    if not isinstance(owner, dict):
        return None
    sub = owner.get("subaccountCode")
    code = owner.get("agentCode")
    rank = owner.get("rank")
    if not isinstance(sub, str) or not _SUBACCOUNT_RE.match(sub):
        return None
    if not isinstance(code, str) or not AGENT_CODE_RE.match(code) or code == TOP_DESK_CODE:
        return None
    if rank not in ds.RANKS:
        return None
    return {"subaccountCode": sub, "agentCode": code, "rank": rank}


def plan_commission(chama: dict, kind: str, amount_kes: float, public_config: dict | None) -> tuple[dict, ds.SplitPlan] | None:
    """
    Pure decision: (owner, plan) when a split is due, else None. Raises DeskConfigError only for a config that
    exists but is unusable (the caller logs it and charges without a split).
    """
    owner = _valid_owner(chama.get("deskOwner"))
    if owner is None or public_config is None:
        return None
    rates = ds.parse_rates(public_config)
    gross = to_minor(amount_kes)
    if gross <= 0:
        return None
    if kind == KIND_SUBSCRIPTION:
        plan = ds.share_plan(owner["rank"], "subscription", rates)
    elif kind == KIND_REPORT:
        plan = ds.share_plan(owner["rank"], "report", rates)
    elif kind == KIND_SMS:
        plan = ds.sms_plan(gross, sms_credits_granted(gross), rates)
    else:
        raise ValueError(f"unknown commission kind {kind!r}")
    if plan.agent_share_pct <= 0 or plan.agent_share_pct >= 100:
        return None
    return owner, plan


def _split_code_for(db, secret_key: str, subaccount_code: str, share_pct: float) -> str:
    """Cached per (subaccount, share) in THIS project; created in MyChama's Paystack account on first use."""
    bps = ds.to_bps(share_pct)
    ref = db.document(f"{SPLIT_CACHE_COLLECTION}/{subaccount_code}_{bps}")
    snap = ref.get()
    if snap.exists:
        cached = (snap.to_dict() or {}).get("splitCode")
        if isinstance(cached, str) and cached:
            return cached
    try:
        body = paystack.create_commission_split(
            secret_key=secret_key,
            name=f"Desk {subaccount_code} {share_pct:g}%",
            subaccount_code=subaccount_code,
            share_pct=share_pct,
        )
        code = ((body or {}).get("data") or {}).get("split_code")
        if not (body or {}).get("status") or not isinstance(code, str) or not code:
            raise ValueError("Paystack returned no split_code")
    except Exception as exc:  # noqa: BLE001
        logging.exception("desk commission: could not create Paystack split for %s at %s%%", subaccount_code, share_pct)
        raise upstream_failure("Could not prepare the payment with Paystack. Please try again.") from exc
    ref.set({"splitCode": code, "subaccountCode": subaccount_code, "sharePct": share_pct, "createdAt": now_ms()})
    return code


def prepare_split(db, secret_key: str, chama: dict, kind: str, amount_kes: float) -> PreparedSplit | None:
    """
    Returns the split to attach to a charge plus the `deskCommission` to store on its intent, or None when the
    chama has no desk owner / desk has not published its config / the share is nothing.
    """
    owner = _valid_owner(chama.get("deskOwner"))
    if owner is None:
        return None
    cfg_snap = db.document(PUBLIC_CONFIG_DOC).get()
    if not cfg_snap.exists:
        return None
    try:
        decided = plan_commission(chama, kind, amount_kes, cfg_snap.to_dict())
    except ds.DeskConfigError:
        logging.exception("desk commission skipped: desk_public_config/global is unusable")
        return None
    if decided is None:
        return None
    owner, plan = decided
    code = _split_code_for(db, secret_key, owner["subaccountCode"], plan.agent_share_pct)
    return PreparedSplit(
        split_code=code,
        desk_commission={"agentCode": owner["agentCode"], "sharePct": plan.agent_share_pct, "rule": plan.rule},
    )
