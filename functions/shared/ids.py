"""
ID & payment-reference builders.

Payment reference format (CROSS-REPO CONTRACT — see docs/ARCHITECTURE.md):
    {PREFIX}-{chamaId}-{purposeCode}-{epochMs}-{rand6}
    e.g. MCA-sunrise01-CNT-1758100000000-A7K2QX

The prefix tells the PAY repo's singleton webhook which project/handler
owns this reference without a lookup. The `{purposeCode}` mirrors CYBER's
buildReference() for MCW- (WhatsApp) references and MUST be reused as-is for
MCA- (app) references so both channels are indistinguishable downstream.

SMS top-up and plan billing references (MCS- / MCP-) omit the purpose code
since there is only one purpose per prefix.
"""

from __future__ import annotations

import random
import string

from .constants import RefPrefix
from .dates import now_ms


def _rand6() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def build_payment_reference(chama_id: str, purpose_code: str, prefix: str = RefPrefix.APP_PAYMENT) -> str:
    """purpose_code is one of IntentPurposeCode.{CONTRIBUTION,LOAN_REPAYMENT,MGR_CONTRIBUTION}."""
    return f"{prefix}-{chama_id}-{purpose_code}-{now_ms()}-{_rand6()}"


def build_sms_topup_reference(chama_id: str) -> str:
    return f"{RefPrefix.SMS_TOPUP}-{chama_id}-{now_ms()}-{_rand6()}"


def build_plan_billing_reference(chama_id: str) -> str:
    return f"{RefPrefix.PLAN_BILLING}-{chama_id}-{now_ms()}-{_rand6()}"


def build_cash_reference() -> str:
    """For manual/cash transactions — mirrors the demo's 'CASH...' convention."""
    return "CASH" + _rand6()


def slugify(text: str) -> str:
    """
    Loan product document IDs are slugs (e.g. flat_emergency), not
    auto-IDs — see firestoreData.json conventions.documentIds.
    """
    cleaned = "".join(c.lower() if c.isalnum() else "_" for c in text.strip())
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned.strip("_")
