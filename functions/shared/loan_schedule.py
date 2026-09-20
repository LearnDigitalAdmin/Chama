"""
Loan schedule maths — MUST be byte-for-byte identical to:
  - CYBER/functions/src/services/mychama.service.ts (calcFlatSchedule, calcReducingSchedule, buildSchedule)
  - src/lib/loanSchedule.ts (this repo, frontend)
  - the original demo's calcFlatSchedule / calcReducingSchedule

A member who sees one repayment figure in the app and another on WhatsApp
loses trust in the product immediately. Any change to this file requires an
identical change to both mirrors in the SAME commit, plus a regression test
against a few fixed (principal, rate, term) tuples across all three.
"""

from __future__ import annotations

from typing import TypedDict, List

from .dates import add_days_iso
from .money import round2
from .types import LoanInstallment, LoanProduct


class ScheduleResult(TypedDict):
    installment: float
    totalInterest: float
    totalPay: float
    schedule: List[LoanInstallment]


def calc_flat_schedule(principal: float, monthly_rate_pct: float, term: int) -> ScheduleResult:
    total_interest = principal * (monthly_rate_pct / 100) * term
    total_pay = principal + total_interest
    installment = total_pay / term

    schedule: List[LoanInstallment] = []
    bal = total_pay

    for i in range(1, term + 1):
        closing = max(0.0, bal - installment)
        schedule.append(
            LoanInstallment(
                n=i,
                due=installment,
                principalPart=principal / term,
                interestPart=total_interest / term,
                opening=bal,
                closing=closing,
                paid=False,
                paidAmount=0,
                dueDate=add_days_iso(i * 30),
            )
        )
        bal = closing

    return ScheduleResult(installment=installment, totalInterest=total_interest, totalPay=total_pay, schedule=schedule)


def calc_reducing_schedule(principal: float, annual_rate_pct: float, term: int) -> ScheduleResult:
    r = annual_rate_pct / 100 / 12
    if r == 0:
        installment = principal / term
    else:
        installment = (principal * r * (1 + r) ** term) / ((1 + r) ** term - 1)

    bal = principal
    total_interest = 0.0
    schedule: List[LoanInstallment] = []

    for i in range(1, term + 1):
        interest = bal * r
        principal_part = installment - interest
        closing = max(0.0, bal - principal_part)
        total_interest += interest

        schedule.append(
            LoanInstallment(
                n=i,
                due=installment,
                principalPart=principal_part,
                interestPart=interest,
                opening=bal,
                closing=closing,
                paid=False,
                paidAmount=0,
                dueDate=add_days_iso(i * 30),
            )
        )
        bal = closing

    return ScheduleResult(
        installment=installment,
        totalInterest=total_interest,
        totalPay=principal + total_interest,
        schedule=schedule,
    )


def build_schedule(product: LoanProduct, principal: float, term: int) -> ScheduleResult:
    if product["type"] == "flat":
        return calc_flat_schedule(principal, product["rate"], term)
    return calc_reducing_schedule(principal, product["rate"], term)


def product_rate_label(product: LoanProduct, language: str = "en") -> str:
    if product["type"] == "flat":
        return (
            f"{product['rate']}% per month (flat)"
            if language == "en"
            else f"{product['rate']}% kwa mwezi (tambarare)"
        )
    return (
        f"{product['rate']}% p.a. (reducing balance)"
        if language == "en"
        else f"{product['rate']}% kwa mwaka (salio linalopungua)"
    )


def loan_outstanding(loan) -> float:
    return round2(sum(max(0.0, (s.get("due") or 0) - (s.get("paidAmount") or 0)) for s in loan.get("schedule", [])))


def loan_paid(loan) -> float:
    return round2(sum(s.get("paidAmount") or 0 for s in loan.get("schedule", [])))


def next_unpaid_installment(loan):
    for s in loan.get("schedule", []):
        if (s.get("due") or 0) - (s.get("paidAmount") or 0) > 0.009:
            return s
    return None
