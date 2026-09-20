"""
MyChama Shared Constants (Python / Cloud Functions)

SINGLE SOURCE OF TRUTH for the mychama1 Firebase project's Python functions.
This file MUST stay value-identical to:
  - src/lib/constants.ts                       (this repo, frontend)
  - CYBER/functions/src/config/mychama.config.ts (FEES, MC, MC_SECURITY)
  - CYBER/functions/src/constants/mychama.messages.ts (reference prefixes)
  - firestoreData.json -> feeEngine / plans (root of this repo)

If a number changes here, it changes in all of the above in the SAME change
set. A member quoted one figure on WhatsApp/App and charged another via
Paystack is the single worst bug this system can ship.

Do not hardcode any of these values anywhere else in the Python codebase —
import from here.
"""

from __future__ import annotations

# --------------------------------------------------------------------------
# Firestore collection names (mirrors CYBER's `MC` map exactly)
# --------------------------------------------------------------------------

class MC:
    CHAMAS = "chamas"
    MEMBERS = "members"
    LOAN_PRODUCTS = "loanProducts"
    CONTRIBUTIONS = "contributions"
    LOANS = "loans"
    TRANSACTIONS = "transactions"
    MGR_POTS = "mgrPots"
    MGR_RECORDS = "records"
    MGR_PAYOUTS = "payouts"
    PAYMENT_INTENTS = "paymentIntents"
    SMS_TOPUPS = "smsTopUps"
    PLAN_BILLING = "planBilling"
    USER_CHAMAS = "userChamas"
    MEMBERSHIPS = "memberships"
    MINUTES = "minutes"
    SETTLEMENTS = "settlements"
    SETTLEMENT_ACCOUNT_REQUESTS = "settlementAccountRequests"
    SMS_LOG = "smsLog"
    SMS_SCHEDULES = "smsSchedules"
    WHATSAPP_AUDIT = "whatsappAuditLog"
    WHATSAPP_RATE_LIMITS = "whatsappRateLimits"
    INVITES = "invites"


# --------------------------------------------------------------------------
# Fee engine — MUST mirror CYBER's FEES constant and firestoreData.json's
# `feeEngine` block exactly, field for field.
# --------------------------------------------------------------------------

PAYSTACK_FEE_RATE = 0.015
PAYSTACK_FEE_CAP = 3000

CONTRIBUTION_MARKUP_RATE = 0.005

LOAN_MARKUP_RATE = {
    "free": None,
    "starter": 0.015,
    "basic": 0.011,
    "growth": 0.007,
    "max": 0.007,
}

MGR_PAYOUT_MARKUP_RATE = {
    "free": None,
    "starter": 0.015,
    "basic": 0.011,
    "growth": 0.007,
    "max": 0.007,
}


# --------------------------------------------------------------------------
# Plans — mirrors firestoreData.json -> plans exactly.
# --------------------------------------------------------------------------

PLAN_ORDER = ["free", "starter", "basic", "growth", "max"]

PLANS = {
    "free":    {"name": "Free",    "price": 0,    "memberLimit": 6,   "smsRate": 0.9, "minutesQuota": 0,    "exportsAllowed": False, "onlineCollection": False},
    "starter": {"name": "Starter", "price": 499,  "memberLimit": 15,  "smsRate": 0.9, "minutesQuota": 1,    "exportsAllowed": True,  "onlineCollection": True},
    "basic":   {"name": "Basic",   "price": 999,  "memberLimit": 25,  "smsRate": 0.9, "minutesQuota": 3,    "exportsAllowed": True,  "onlineCollection": True},
    "growth":  {"name": "Growth",  "price": 2499, "memberLimit": 60,  "smsRate": 0.7, "minutesQuota": None, "exportsAllowed": True,  "onlineCollection": True},
    "max":     {"name": "Max",     "price": 4990, "memberLimit": 999, "smsRate": 0.5, "minutesQuota": None, "exportsAllowed": True,  "onlineCollection": True},
}


def can_collect_online(plan: str) -> bool:
    return plan != "free"


def member_limit_for(plan: str) -> int:
    return PLANS.get(plan, PLANS["free"])["memberLimit"]


# --------------------------------------------------------------------------
# Security / session windows — mirrors CYBER's MC_SECURITY.
# These specific windows govern the WhatsApp bot's session; the app enforces
# its own equivalents (Firebase Auth session persistence, re-auth-on-money
# prompts) documented in docs/ARCHITECTURE.md.
# --------------------------------------------------------------------------

REAUTH_AFTER_SECONDS = 15 * 60
MAX_AUTH_ATTEMPTS = 3
AUTH_LOCKOUT_SECONDS = 15 * 60
MAX_INTENTS_PER_HOUR = 10
PAYMENT_INTENT_TTL_SECONDS = 30 * 60  # expiresAt = createdAt + 30 minutes

# Mirrors src/lib/constants.ts's SECURITY object exactly — added so Python
# code can import one namespaced dict instead of five module-level names
# that were easy to forget to mirror. Prefer this over the bare names above
# in new code; the bare names stay for backward compatibility.
SECURITY = {
    "REAUTH_AFTER_SECONDS": REAUTH_AFTER_SECONDS,
    "MAX_AUTH_ATTEMPTS": MAX_AUTH_ATTEMPTS,
    "AUTH_LOCKOUT_SECONDS": AUTH_LOCKOUT_SECONDS,
    "MAX_INTENTS_PER_HOUR": MAX_INTENTS_PER_HOUR,
    "PAYMENT_INTENT_TTL_SECONDS": PAYMENT_INTENT_TTL_SECONDS,
}


# --------------------------------------------------------------------------
# Payment reference prefix registry — CROSS-REPO CONTRACT.
#
# Every payment reference created anywhere in the MyChama system (CYBER bot,
# this project's Python functions) starts with one of these prefixes. The
# PAY repo's singleton `paystackCallback` webhook dispatches on this prefix
# (see docs/ARCHITECTURE.md "Webhook dispatch contract"). Adding a new kind
# of MyChama charge means adding a prefix HERE FIRST, then teaching the PAY
# webhook about it — never invent a prefix ad hoc in a handler.
# --------------------------------------------------------------------------

class RefPrefix:
    WHATSAPP_PAYMENT = "MCW"   # existing — WhatsApp bot payment intents (CYBER)
    APP_PAYMENT = "MCA"        # app-initiated payment intents (contribution / loan_repayment / mgr_contribution)
    SMS_TOPUP = "MCS"          # SMS credit top-up
    PLAN_BILLING = "MCP"       # plan subscription / upgrade billing


class IntentPurposeCode:
    CONTRIBUTION = "CNT"
    LOAN_REPAYMENT = "LNR"
    MGR_CONTRIBUTION = "MGR"
