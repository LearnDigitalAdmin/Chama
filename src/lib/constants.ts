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

export const PLANS: Record<
  ChamaPlan,
  {
    name: string;
    price: number;
    memberLimit: number;
    smsRate: number;
    minutesQuota: number | null;
    exportsAllowed: boolean;
    onlineCollection: boolean;
  }
> = {
  free: { name: 'Free', price: 0, memberLimit: 6, smsRate: 0.9, minutesQuota: 0, exportsAllowed: false, onlineCollection: false },
  starter: { name: 'Starter', price: 499, memberLimit: 15, smsRate: 0.9, minutesQuota: 1, exportsAllowed: true, onlineCollection: true },
  basic: { name: 'Basic', price: 999, memberLimit: 25, smsRate: 0.9, minutesQuota: 3, exportsAllowed: true, onlineCollection: true },
  growth: { name: 'Growth', price: 2499, memberLimit: 60, smsRate: 0.7, minutesQuota: null, exportsAllowed: true, onlineCollection: true },
  max: { name: 'Max', price: 4990, memberLimit: 999, smsRate: 0.5, minutesQuota: null, exportsAllowed: true, onlineCollection: true },
};

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
      'Excel + PDF exports',
      '1 free export/month, KES 100 after',
      'Email support',
    ],
  },
  basic: {
    blurb: 'For a chama with steady cash flow.',
    features: [
      'Up to 25 members',
      'Paystack collections (contributions, loan repayments, MGR-ins)',
      'Merry-go-round with smart draws — payouts recorded in cash for now',
      'Excel + PDF exports',
      '3 free exports/month, KES 100 after',
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
      'Unlimited exports',
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
      'Unlimited exports',
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
