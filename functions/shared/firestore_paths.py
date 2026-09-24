"""
Firestore path builders — mirrors CYBER's `mcPath` object and
src/lib/firestorePaths.ts. Keeps string concatenation out of every
callable/trigger so a path never drifts between modules.
"""

from __future__ import annotations

from .constants import MC


def chama(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}"


def members(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MEMBERS}"


def member(chama_id: str, member_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MEMBERS}/{member_id}"


def loan_products(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.LOAN_PRODUCTS}"


def loan_product(chama_id: str, product_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.LOAN_PRODUCTS}/{product_id}"


def contributions(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.CONTRIBUTIONS}"


def contribution(chama_id: str, contribution_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.CONTRIBUTIONS}/{contribution_id}"


def loans(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.LOANS}"


def loan(chama_id: str, loan_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.LOANS}/{loan_id}"


def transactions(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.TRANSACTIONS}"


def mgr_pots(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}"


def mgr_pot(chama_id: str, pot_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}/{pot_id}"


def mgr_records(chama_id: str, pot_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}/{pot_id}/{MC.MGR_RECORDS}"


def mgr_record(chama_id: str, pot_id: str, record_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}/{pot_id}/{MC.MGR_RECORDS}/{record_id}"


def mgr_payouts(chama_id: str, pot_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}/{pot_id}/{MC.MGR_PAYOUTS}"


def mgr_arrears(chama_id: str, pot_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}/{pot_id}/{MC.MGR_ARREARS}"


def mgr_arrear(chama_id: str, pot_id: str, arrear_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}/{pot_id}/{MC.MGR_ARREARS}/{arrear_id}"


def mgr_exits(chama_id: str, pot_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}/{pot_id}/{MC.MGR_EXITS}"


def mgr_exit(chama_id: str, pot_id: str, exit_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}/{pot_id}/{MC.MGR_EXITS}/{exit_id}"


def mgr_ledger(chama_id: str, pot_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MGR_POTS}/{pot_id}/{MC.MGR_LEDGER}"


def payment_intents(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.PAYMENT_INTENTS}"


def payment_intent(chama_id: str, reference: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.PAYMENT_INTENTS}/{reference}"


def sms_topups(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.SMS_TOPUPS}"


def sms_topup(chama_id: str, reference: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.SMS_TOPUPS}/{reference}"


def plan_billing(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.PLAN_BILLING}"


def plan_billing_doc(chama_id: str, reference: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.PLAN_BILLING}/{reference}"


def minutes(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.MINUTES}"


def settlements(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.SETTLEMENTS}"


def settlement_account_requests(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.SETTLEMENT_ACCOUNT_REQUESTS}"


def sms_log(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.SMS_LOG}"


def sms_schedules(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.SMS_SCHEDULES}"


def invites(chama_id: str) -> str:
    return f"{MC.CHAMAS}/{chama_id}/{MC.INVITES}"


def user_chama_membership(uid: str, chama_id: str) -> str:
    return f"{MC.USER_CHAMAS}/{uid}/{MC.MEMBERSHIPS}/{chama_id}"


def user_chama_memberships(uid: str) -> str:
    return f"{MC.USER_CHAMAS}/{uid}/{MC.MEMBERSHIPS}"
