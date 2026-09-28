/**
 * MyChama Shared Constants (Frontend / TypeScript)
 *
 * MUST stay value-identical to functions/shared/constants.py (this repo) and
 * CYBER/functions/src/config/mychama.config.ts. See that file's docstring
 * for the consistency rule — it applies here too.
 */

import type { ChamaPlan } from './types';

export const MC = {
  CHAMAS: 'chamas',
  MEMBERS: 'members',
  LOAN_PRODUCTS: 'loanProducts',
  CONTRIBUTIONS: 'contributions',
  LOANS: 'loans',
  TRANSACTIONS: 'transactions',
  MGR_POTS: 'mgrPots',
  MGR_RECORDS: 'records',
  MGR_PAYOUTS: 'payouts',
  MGR_ARREARS: 'arrears',
  MGR_EXITS: 'exits',
  MGR_LEDGER: 'ledger',
  PAYMENT_INTENTS: 'paymentIntents',
  SMS_TOPUPS: 'smsTopUps',
  PLAN_BILLING: 'planBilling',
  USER_CHAMAS: 'userChamas',
  MEMBERSHIPS: 'memberships',
  MINUTES: 'minutes',
  SETTLEMENTS: 'settlements',
  SETTLEMENT_ACCOUNT_REQUESTS: 'settlementAccountRequests',
  SMS_LOG: 'smsLog',
  SMS_SCHEDULES: 'smsSchedules',
  WHATSAPP_AUDIT: 'whatsappAuditLog',
  INVITES: 'invites',
  REPORT_CREDIT_TOPUPS: 'reportCreditTopUps',
  REPORT_ALACARTE_PURCHASES: 'reportAlacartePurchases',
} as const;

export const FEES = {
  PAYSTACK_FEE_RATE: 0.015,
  PAYSTACK_FEE_CAP: 3000,
  CONTRIBUTION_MARKUP_RATE: 0.005,
  LOAN_MARKUP_RATE: {
    free: null,
    starter: 0.015,
    basic: 0.011,
    growth: 0.007,
    max: 0.007,
  } as Record<ChamaPlan, number | null>,
  MGR_PAYOUT_MARKUP_RATE: {
    free: null,
    starter: 0.015,
    basic: 0.011,
    growth: 0.007,
    max: 0.007,
  } as Record<ChamaPlan, number | null>,
} as const;

export const PLAN_ORDER: ChamaPlan[] = ['free', 'starter', 'basic', 'growth', 'max'];

/**
 * `minutesQuota` (pre-reports-engine) is RETIRED in favour of two explicit
 * credit pools — see functions/shared/constants.py's PLANS docstring for
 * the full explanation (standardReportCredits / premiumReportCredits /
 * premiumAlacarteCapPerMonth), which this MUST stay value-identical to.
 */

/**
 * NOTE: smsRate below is the KES price paid PER CREDIT when topping up
 * (cheaper tiers get a bulk discount) — it is NOT the number of credits
 * an SMS costs to send. Sending always costs exactly 1 credit per segment
 * (see src/lib/smsValidation.ts), regardless of plan. Only use smsRate to
 * show a KES-equivalent of a credits total, never to compute the credits
 * a send itself deducts.
 */
export const PLANS: Record<
  ChamaPlan,
  {
    name: string;
    price: number;
    memberLimit: number;
    smsRate: number;
    exportsAllowed: boolean;
    onlineCollection: boolean;
    standardReportCredits: number | null; // null = unlimited
    premiumReportCredits: number;
    premiumAlacarteCapPerMonth: number | null; // null = not applicable (Growth/Max use premiumReportCredits + the wallet instead)
  }
> = {
  free: { name: 'Free', price: 0, memberLimit: 6, smsRate: 0.9, exportsAllowed: false, onlineCollection: false, standardReportCredits: 0, premiumReportCredits: 0, premiumAlacarteCapPerMonth: 0 },
  starter: { name: 'Starter', price: 499, memberLimit: 15, smsRate: 0.9, exportsAllowed: true, onlineCollection: true, standardReportCredits: 3, premiumReportCredits: 0, premiumAlacarteCapPerMonth: 1 },
  basic: { name: 'Basic', price: 999, memberLimit: 25, smsRate: 0.9, exportsAllowed: true, onlineCollection: true, standardReportCredits: 8, premiumReportCredits: 0, premiumAlacarteCapPerMonth: 2 },
  growth: { name: 'Growth', price: 2499, memberLimit: 60, smsRate: 0.7, exportsAllowed: true, onlineCollection: true, standardReportCredits: null, premiumReportCredits: 4, premiumAlacarteCapPerMonth: null },
  max: { name: 'Max', price: 4990, memberLimit: 999, smsRate: 0.5, exportsAllowed: true, onlineCollection: true, standardReportCredits: null, premiumReportCredits: 10, premiumAlacarteCapPerMonth: null },
};

// ---------------------------------------------------------------------------
// Reports engine — catalog, tiering & pricing. All KES prices already
// include the standing 20% launch discount — see functions/shared/constants.py's
// matching docstring before changing any of these four numbers.
// ---------------------------------------------------------------------------

export const REPORT_WALLET_CREDIT_PRICE_KES = 56;
export const REPORT_WALLET_BUNDLE_10_KES = 504;
export const REPORT_WALLET_BUNDLE_30_KES = 1400;
export const PREMIUM_ALACARTE_CREDIT_PRICE_KES = 144;

export const REPORT_WALLET_BUNDLES: Record<number, number> = {
  1: REPORT_WALLET_CREDIT_PRICE_KES,
  10: REPORT_WALLET_BUNDLE_10_KES,
  30: REPORT_WALLET_BUNDLE_30_KES,
};

export type ReportKey =
  | 'member_statement'
  | 'contribution_ledger'
  | 'arrears_penalties'
  | 'minutes'
  | 'cashflow'
  | 'profit_loss'
  | 'balance_sheet';

export const REPORT_TYPES: Record<
  ReportKey,
  {
    label: string;
    tier: 'standard' | 'premium';
    credits: number;
    periodMode: 'range' | 'as_of' | 'single';
    encryptDefault: boolean;
    encryptOptional: boolean;
  }
> = {
  member_statement: { label: 'Individual Member Statement', tier: 'standard', credits: 1, periodMode: 'range', encryptDefault: true, encryptOptional: false },
  contribution_ledger: { label: 'Contribution Summary & Tracking Ledger', tier: 'standard', credits: 1, periodMode: 'range', encryptDefault: false, encryptOptional: true },
  arrears_penalties: { label: 'Arrears & Penalties Report', tier: 'standard', credits: 2, periodMode: 'as_of', encryptDefault: false, encryptOptional: true },
  minutes: { label: 'Meeting Minutes Export', tier: 'standard', credits: 1, periodMode: 'single', encryptDefault: false, encryptOptional: false },
  cashflow: { label: 'Cashflow Statement', tier: 'premium', credits: 2, periodMode: 'range', encryptDefault: false, encryptOptional: true },
  profit_loss: { label: 'Profit & Loss Statement', tier: 'premium', credits: 3, periodMode: 'range', encryptDefault: true, encryptOptional: false },
  balance_sheet: { label: 'Balance Sheet', tier: 'premium', credits: 3, periodMode: 'as_of', encryptDefault: true, encryptOptional: false },
};

export function reportPriceKes(key: ReportKey): number {
  return REPORT_TYPES[key].credits * REPORT_WALLET_CREDIT_PRICE_KES;
}

export function premiumAlacartePriceKes(key: ReportKey): number {
  return REPORT_TYPES[key].credits * PREMIUM_ALACARTE_CREDIT_PRICE_KES;
}

/**
 * Presentational-only plan copy for the Billing screen — ported verbatim
 * from the demo's PLANS[key].blurb/features. NOT part of the cross-repo
 * contract (functions/shared/constants.py has no equivalent and doesn't
 * need one): nothing here is a number a Paystack charge or a plan-limit
 * check depends on, so it doesn't need to be mirrored server-side.
 */
export const PLAN_COPY: Record<ChamaPlan, { blurb: string; features: string[] }> = {
  free: {
    blurb: 'Try MyChama with a small group.',
    features: [
      'Up to 6 members (excl. admins)',
      'Manual loan disbursement & repayment only',
      'Manual contribution recording',
      'Merry-go-round with smart draws (manual payouts)',
      'No Excel/PDF exports',
      'Community support',
    ],
  },
  starter: {
    blurb: 'For a chama finding its footing.',
    features: [
      'Up to 15 members',
      'Paystack collections (contributions, loan repayments, MGR-ins)',
      'Merry-go-round with smart draws — payouts recorded in cash for now',
      'Statements, contribution ledger & arrears reports — 3 credits/month',
      '1 premium financial statement/month as a one-off purchase',
      'Email support',
    ],
  },
  basic: {
    blurb: 'For a chama with steady cash flow.',
    features: [
      'Up to 25 members',
      'Paystack collections (contributions, loan repayments, MGR-ins)',
      'Merry-go-round with smart draws — payouts recorded in cash for now',
      'Statements, contribution ledger & arrears reports — 8 credits/month',
      '2 premium financial statements/month as a one-off purchase',
      'Email support',
    ],
  },
  growth: {
    blurb: 'For an active, growing chama.',
    features: [
      'Up to 60 members',
      'Unlimited loan products',
      'Automatic settlement to your paybill/till/bank',
      'Merry-go-round with smart draws — payouts recorded in cash for now',
      'Unlimited statements, contribution ledger & arrears reports',
      'Cashflow, P&L & Balance Sheet — 4 premium credits/month included',
      'Priority support',
    ],
  },
  max: {
    blurb: 'For federations & large SACCOs-in-waiting.',
    features: [
      'Unlimited members',
      'Multiple sub-groups (coming soon)',
      'Cheapest SMS credit rate',
      'Merry-go-round with smart draws — payouts recorded in cash for now',
      'Unlimited statements, contribution ledger & arrears reports',
      'Cashflow, P&L & Balance Sheet — 10 premium credits/month included',
      'Priority phone support',
    ],
  },
};

export function canCollectOnline(plan: ChamaPlan): boolean {
  return plan !== 'free';
}

/**
 * Payment reference prefix registry — CROSS-REPO CONTRACT.
 * See docs/CONVENTIONS.md "Reference prefix registry" before adding one.
 */
export const REF_PREFIX = {
  WHATSAPP_PAYMENT: 'MCW',
  APP_PAYMENT: 'MCA',
  SMS_TOPUP: 'MCS',
  PLAN_BILLING: 'MCP',
  REPORT_CREDIT_TOPUP: 'MCX',
  REPORT_ALACARTE: 'MCR',
} as const;

export const INTENT_PURPOSE_CODE = {
  CONTRIBUTION: 'CNT',
  LOAN_REPAYMENT: 'LNR',
  MGR_CONTRIBUTION: 'MGR',
} as const;

export const SECURITY = {
  REAUTH_AFTER_SECONDS: 15 * 60,
  MAX_AUTH_ATTEMPTS: 3,
  AUTH_LOCKOUT_SECONDS: 15 * 60,
  MAX_INTENTS_PER_HOUR: 10,
  PAYMENT_INTENT_TTL_SECONDS: 30 * 60,
} as const;

// SMS segment breakpoints (140/270/385 chars) and content-validation rules
// live in src/lib/smsValidation.ts, mirroring functions/shared/sms_validation.py.

export const AUDIENCE_LABEL: Record<string, string> = {
  all: 'To everyone',
  overdue: 'To overdue contributors',
  loan_holders: 'To active loan holders',
  admins: 'To admins only',
  custom: 'To selected members',
};
