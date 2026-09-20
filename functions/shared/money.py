"""
Money formatting & fee engine — MUST mirror:
  - CYBER/functions/src/services/mychama.service.ts (kes, grossUpForFees, contributionFees, loanRepaymentFees)
  - src/lib/money.ts (this repo, frontend)
  - firestoreData.json -> feeEngine

Never store money as a string. Always round2() before writing a Firestore
money field. Fees are stored ALONGSIDE the net amount, never subtracted
from it.
"""

from __future__ import annotations

from .constants import (
    PAYSTACK_FEE_RATE,
    PAYSTACK_FEE_CAP,
    CONTRIBUTION_MARKUP_RATE,
    LOAN_MARKUP_RATE,
    MGR_PAYOUT_MARKUP_RATE,
)
from .types import FeeBreakdown


def round2(n: float) -> float:
    return round((n or 0) * 100) / 100


def kes(amount: float) -> str:
    return "KES " + f"{round(amount):,}"


def paystack_fee_for(amount: float) -> float:
    return min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP)


def gross_up_for_fees(net: float, our_rate: float) -> FeeBreakdown:
    """
    Money IN (contributions, loan repayments, MGR collections).
    Finds the charge that leaves exactly `net` in the chama account after
    Paystack's fee AND the MyChama markup are both taken from the charge.
    """
    gross = net / (1 - PAYSTACK_FEE_RATE - our_rate)
    p_fee = gross * PAYSTACK_FEE_RATE

    if p_fee > PAYSTACK_FEE_CAP:
        gross = (net + PAYSTACK_FEE_CAP) / (1 - our_rate)
        p_fee = PAYSTACK_FEE_CAP

    our_fee = gross * our_rate

    return FeeBreakdown(
        net=net,
        gross=round2(gross),
        paystackFee=round2(p_fee),
        ourFee=round2(our_fee),
    )


def contribution_fees(net: float) -> FeeBreakdown:
    return gross_up_for_fees(net, CONTRIBUTION_MARKUP_RATE)


def loan_repayment_fees(net: float, plan: str) -> FeeBreakdown:
    rate = LOAN_MARKUP_RATE.get(plan)
    return gross_up_for_fees(net, rate or 0)


def mgr_contribution_fees(net: float) -> FeeBreakdown:
    """MGR collections use the same markup as contributions (see demo)."""
    return gross_up_for_fees(net, CONTRIBUTION_MARKUP_RATE)


def disbursement_cost(principal: float, plan: str, rate_table: dict = None) -> dict:
    """
    Money OUT (loan disbursement, MGR payout). Fees are ADDED ON TOP of the
    principal and deducted from the chama balance; the recipient receives
    the full principal. totalDeducted = principal + paystackFee + ourFee.
    """
    table = rate_table if rate_table is not None else LOAN_MARKUP_RATE
    rate = table.get(plan) or 0
    paystack_fee = paystack_fee_for(principal)
    our_fee = round2(principal * rate)
    return {
        "principal": principal,
        "paystackFee": round2(paystack_fee),
        "ourFee": our_fee,
        "totalDeducted": round2(principal + paystack_fee + our_fee),
    }


def mgr_payout_cost(amount: float, plan: str) -> dict:
    return disbursement_cost(amount, plan, MGR_PAYOUT_MARKUP_RATE)
