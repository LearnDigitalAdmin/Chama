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
    MGR_ARREARS = "arrears"
    MGR_EXITS = "exits"
    MGR_LEDGER = "ledger"
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
    REPORT_CREDIT_TOPUPS = "reportCreditTopUps"
    REPORT_ALACARTE_PURCHASES = "reportAlacartePurchases"


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
#
# `minutesQuota` / `minutesExportsUsedThisMonth` (pre-reports-engine) are
# RETIRED in favour of two explicit credit pools, added by the reports
# engine (see REPORT_TYPES and functions/shared/reports_engine.py below):
#
#   standardReportCredits  — monthly allowance for STANDARD reports
#                             (member statement, contribution ledger,
#                             arrears & penalties, minutes export).
#                             None = unlimited.
#   premiumReportCredits    — monthly allowance for PREMIUM reports (the
#                             three formal financial statements: cashflow,
#                             P&L, balance sheet). 0 means premium reports
#                             are not unlockable on this plan at all
#                             (Starter/Basic) except via the à la carte
#                             one-off purchase below.
#   premiumAlacarteCapPerMonth — Starter/Basic only. How many premium
#                             reports/month can be bought one-off (see
#                             `purchasePremiumReportAlaCarte` in
#                             functions/mychama/reports.py) WITHOUT
#                             upgrading. None on Growth/Max — not
#                             applicable, they already get premiumReportCredits
#                             + can top up the reportCreditsBalance wallet.
#
# A chama on any paid plan keeps ONE prepaid wallet, `reportCreditsBalance`
# (see Chama in types.py) — on Starter/Basic it tops up STANDARD credits
# beyond the monthly allowance; on Growth/Max it tops up PREMIUM credits
# beyond theirs (Growth/Max standard reports are already unlimited, so
# there's nothing to top up there). Which meaning applies is derived from
# the chama's current plan at spend time — see reports_engine.spend_credits.
# --------------------------------------------------------------------------

PLAN_ORDER = ["free", "starter", "basic", "growth", "max"]

# NOTE: smsRate below is the KES price paid PER CREDIT when topping up
# (cheaper tiers get a bulk discount), converted by the PAY repo's webhook
# when it credits chamas.smsCredits on a successful top-up. It is NOT the
# number of credits an SMS costs to send — sending always costs exactly 1
# credit per segment (see functions/shared/sms_validation.py), regardless
# of plan. Don't multiply smsRate into a send-time cost again.
PLANS = {
    "free":    {"name": "Free",    "price": 0,    "memberLimit": 6,   "smsRate": 0.9, "exportsAllowed": False, "onlineCollection": False, "standardReportCredits": 0,    "premiumReportCredits": 0,  "premiumAlacarteCapPerMonth": 0},
    "starter": {"name": "Starter", "price": 499,  "memberLimit": 15,  "smsRate": 0.9, "exportsAllowed": True,  "onlineCollection": True,  "standardReportCredits": 3,    "premiumReportCredits": 0,  "premiumAlacarteCapPerMonth": 1},
    "basic":   {"name": "Basic",   "price": 999,  "memberLimit": 25,  "smsRate": 0.9, "exportsAllowed": True,  "onlineCollection": True,  "standardReportCredits": 8,    "premiumReportCredits": 0,  "premiumAlacarteCapPerMonth": 2},
    "growth":  {"name": "Growth",  "price": 2499, "memberLimit": 60,  "smsRate": 0.7, "exportsAllowed": True,  "onlineCollection": True,  "standardReportCredits": None, "premiumReportCredits": 4,  "premiumAlacarteCapPerMonth": None},
    "max":     {"name": "Max",     "price": 4990, "memberLimit": 999, "smsRate": 0.5, "exportsAllowed": True,  "onlineCollection": True,  "standardReportCredits": None, "premiumReportCredits": 10, "premiumAlacarteCapPerMonth": None},
}


def can_collect_online(plan: str) -> bool:
    return plan != "free"


def member_limit_for(plan: str) -> int:
    return PLANS.get(plan, PLANS["free"])["memberLimit"]


# --------------------------------------------------------------------------
# Reports engine — catalog, tiering & pricing.
#
# All KES prices below already include the standing 20% discount agreed
# for launch (base à la carte / surcharge rates were 70 and 180/credit
# respectively — see the pricing thread in TOUCH_BASE.md "Reports engine
# pricing"). If the discount is ever revisited, change ONLY the four
# constants immediately below — everything else derives from them.
# --------------------------------------------------------------------------

REPORT_WALLET_CREDIT_PRICE_KES = 56          # base rate, à la carte (was 70 pre-discount)
REPORT_WALLET_BUNDLE_10_KES = 504            # 10 credits (was 630)
REPORT_WALLET_BUNDLE_30_KES = 1400           # 30 credits (was 1750)
PREMIUM_ALACARTE_CREDIT_PRICE_KES = 144      # Starter/Basic one-off premium surcharge, per credit (was 180)

REPORT_WALLET_BUNDLES = {
    1: REPORT_WALLET_CREDIT_PRICE_KES,
    10: REPORT_WALLET_BUNDLE_10_KES,
    30: REPORT_WALLET_BUNDLE_30_KES,
}


class ReportTier:
    STANDARD = "standard"
    PREMIUM = "premium"


class ReportPeriodMode:
    RANGE = "range"          # needs from/to (Cashflow, P&L, Member Statement, Contribution Ledger)
    AS_OF = "as_of"           # a single point-in-time snapshot (Balance Sheet, Arrears & Penalties)
    SINGLE = "single"         # not date-scoped at all (one minutes entry)


# credits: how many units this report costs out of its tier's monthly pool
#          (or the prepaid wallet, once the pool is exhausted).
# encryptDefault / encryptOptional: see docs/ARCHITECTURE.md "Reports engine
#   encryption policy" — encryptDefault True + encryptOptional False means
#   the report is ALWAYS encrypted with a PIN (no UI toggle); encryptDefault
#   False + encryptOptional True means the admin can flip a toggle on.
REPORT_TYPES = {
    "member_statement":    {"label": "Individual Member Statement",         "tier": ReportTier.STANDARD, "credits": 1, "periodMode": ReportPeriodMode.RANGE,  "encryptDefault": True,  "encryptOptional": False},
    "contribution_ledger": {"label": "Contribution Summary & Tracking Ledger", "tier": ReportTier.STANDARD, "credits": 1, "periodMode": ReportPeriodMode.RANGE,  "encryptDefault": False, "encryptOptional": True},
    "arrears_penalties":   {"label": "Arrears & Penalties Report",          "tier": ReportTier.STANDARD, "credits": 2, "periodMode": ReportPeriodMode.AS_OF,  "encryptDefault": False, "encryptOptional": True},
    "minutes":             {"label": "Meeting Minutes Export",              "tier": ReportTier.STANDARD, "credits": 1, "periodMode": ReportPeriodMode.SINGLE, "encryptDefault": False, "encryptOptional": False},
    "cashflow":            {"label": "Cashflow Statement",                  "tier": ReportTier.PREMIUM,  "credits": 2, "periodMode": ReportPeriodMode.RANGE,  "encryptDefault": False, "encryptOptional": True},
    "profit_loss":         {"label": "Profit & Loss Statement",             "tier": ReportTier.PREMIUM,  "credits": 3, "periodMode": ReportPeriodMode.RANGE,  "encryptDefault": True,  "encryptOptional": False},
    "balance_sheet":       {"label": "Balance Sheet",                       "tier": ReportTier.PREMIUM,  "credits": 3, "periodMode": ReportPeriodMode.AS_OF,  "encryptDefault": True,  "encryptOptional": False},
}


def report_price_kes(report_key: str) -> int:
    """À la carte wallet price for one instance of this report, at the base per-credit rate."""
    return REPORT_TYPES[report_key]["credits"] * REPORT_WALLET_CREDIT_PRICE_KES


def premium_alacarte_price_kes(report_key: str) -> int:
    """Starter/Basic one-off premium-report price (surcharge rate, not the wallet rate)."""
    return REPORT_TYPES[report_key]["credits"] * PREMIUM_ALACARTE_CREDIT_PRICE_KES


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
    REPORT_CREDIT_TOPUP = "MCX"     # reports-engine prepaid wallet top-up (purchaseReportCredits)
    REPORT_ALACARTE = "MCR"         # Starter/Basic one-off premium report purchase (purchasePremiumReportAlaCarte)
    # NEW PREFIXES ARE NOT YET WIRED IN THE EXTERNAL "PAY" REPO'S WEBHOOK.
    # See TOUCH_BASE.md "Reports engine — PAY-repo follow-up" before relying
    # on MCX-/MCR- payments actually crediting anything in production.


class IntentPurposeCode:
    CONTRIBUTION = "CNT"
    LOAN_REPAYMENT = "LNR"
    MGR_CONTRIBUTION = "MGR"
