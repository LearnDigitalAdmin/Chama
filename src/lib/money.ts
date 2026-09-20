/**
 * Money formatting & fee engine — MUST mirror functions/shared/money.py
 * (this repo) and CYBER's mychama.service.ts (kes, grossUpForFees,
 * contributionFees, loanRepaymentFees).
 *
 * Never store money as a string. Always round2() before writing a Firestore
 * money field. Fees are stored ALONGSIDE the net amount, never subtracted
 * from it.
 */

import { FEES } from './constants';
import type { ChamaPlan, FeeBreakdown } from './types';

export function round2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}

export function kes(amount: number): string {
  return 'KES ' + Math.round(amount).toLocaleString('en-KE');
}

export function paystackFeeFor(amount: number): number {
  return Math.min(amount * FEES.PAYSTACK_FEE_RATE, FEES.PAYSTACK_FEE_CAP);
}

/**
 * Money IN (contributions, loan repayments, MGR collections).
 * Finds the charge that leaves exactly `net` in the chama account after
 * Paystack's fee AND the MyChama markup are both taken from the charge.
 */
export function grossUpForFees(net: number, ourRate: number): FeeBreakdown {
  let gross = net / (1 - FEES.PAYSTACK_FEE_RATE - ourRate);
  let pFee = gross * FEES.PAYSTACK_FEE_RATE;

  if (pFee > FEES.PAYSTACK_FEE_CAP) {
    gross = (net + FEES.PAYSTACK_FEE_CAP) / (1 - ourRate);
    pFee = FEES.PAYSTACK_FEE_CAP;
  }

  const ourFee = gross * ourRate;

  return {
    net,
    gross: round2(gross),
    paystackFee: round2(pFee),
    ourFee: round2(ourFee),
  };
}

export function contributionFees(net: number): FeeBreakdown {
  return grossUpForFees(net, FEES.CONTRIBUTION_MARKUP_RATE);
}

export function loanRepaymentFees(net: number, plan: ChamaPlan): FeeBreakdown {
  const rate = FEES.LOAN_MARKUP_RATE[plan];
  return grossUpForFees(net, rate ?? 0);
}

export function mgrContributionFees(net: number): FeeBreakdown {
  return grossUpForFees(net, FEES.CONTRIBUTION_MARKUP_RATE);
}

/**
 * Money OUT (loan disbursement, MGR payout). Fees are ADDED ON TOP of the
 * principal and deducted from the chama balance; the recipient receives the
 * full principal. totalDeducted = principal + paystackFee + ourFee.
 */
export function disbursementCost(
  principal: number,
  plan: ChamaPlan,
  rateTable: Record<ChamaPlan, number | null> = FEES.LOAN_MARKUP_RATE
): { principal: number; paystackFee: number; ourFee: number; totalDeducted: number } {
  const rate = rateTable[plan] ?? 0;
  const paystackFee = paystackFeeFor(principal);
  const ourFee = round2(principal * rate);
  return {
    principal,
    paystackFee: round2(paystackFee),
    ourFee,
    totalDeducted: round2(principal + paystackFee + ourFee),
  };
}

export function mgrPayoutCost(amount: number, plan: ChamaPlan) {
  return disbursementCost(amount, plan, FEES.MGR_PAYOUT_MARKUP_RATE);
}
