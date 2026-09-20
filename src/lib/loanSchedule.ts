/**
 * Loan schedule maths — MUST be byte-for-byte identical to
 * functions/shared/loan_schedule.py (this repo) and CYBER's
 * mychama.service.ts (calcFlatSchedule, calcReducingSchedule, buildSchedule).
 *
 * A member who sees one repayment figure in the app and another on WhatsApp
 * loses trust in the product immediately. Any change to this file requires
 * an identical change to both mirrors in the SAME commit, plus a regression
 * test against a few fixed (principal, rate, term) tuples across all three.
 */

import { addDaysISO } from './dates';
import type { LoanInstallment, LoanProduct } from './types';

export interface ScheduleResult {
  installment: number;
  totalInterest: number;
  totalPay: number;
  schedule: LoanInstallment[];
}

export function calcFlatSchedule(principal: number, monthlyRatePct: number, term: number): ScheduleResult {
  const totalInterest = principal * (monthlyRatePct / 100) * term;
  const totalPay = principal + totalInterest;
  const installment = totalPay / term;

  const schedule: LoanInstallment[] = [];
  let bal = totalPay;

  for (let i = 1; i <= term; i++) {
    const closing = Math.max(0, bal - installment);
    schedule.push({
      n: i,
      due: installment,
      principalPart: principal / term,
      interestPart: totalInterest / term,
      opening: bal,
      closing,
      paid: false,
      paidAmount: 0,
      dueDate: addDaysISO(i * 30),
    });
    bal = closing;
  }

  return { installment, totalInterest, totalPay, schedule };
}

export function calcReducingSchedule(principal: number, annualRatePct: number, term: number): ScheduleResult {
  const r = annualRatePct / 100 / 12;
  const installment = r === 0 ? principal / term : (principal * r * Math.pow(1 + r, term)) / (Math.pow(1 + r, term) - 1);

  let bal = principal;
  let totalInterest = 0;
  const schedule: LoanInstallment[] = [];

  for (let i = 1; i <= term; i++) {
    const interest = bal * r;
    const principalPart = installment - interest;
    const closing = Math.max(0, bal - principalPart);
    totalInterest += interest;

    schedule.push({
      n: i,
      due: installment,
      principalPart,
      interestPart: interest,
      opening: bal,
      closing,
      paid: false,
      paidAmount: 0,
      dueDate: addDaysISO(i * 30),
    });
    bal = closing;
  }

  return { installment, totalInterest, totalPay: principal + totalInterest, schedule };
}

export function buildSchedule(product: LoanProduct, principal: number, term: number): ScheduleResult {
  return product.type === 'flat'
    ? calcFlatSchedule(principal, product.rate, term)
    : calcReducingSchedule(principal, product.rate, term);
}

export function loanOutstanding(loan: { schedule: LoanInstallment[] }): number {
  return Math.round(
    loan.schedule.reduce((sum, s) => sum + Math.max(0, (s.due || 0) - (s.paidAmount || 0)), 0) * 100
  ) / 100;
}

export function loanPaid(loan: { schedule: LoanInstallment[] }): number {
  return Math.round(loan.schedule.reduce((sum, s) => sum + (s.paidAmount || 0), 0) * 100) / 100;
}

export function nextUnpaidInstallment(loan: { schedule: LoanInstallment[] }): LoanInstallment | null {
  return loan.schedule.find((s) => (s.due || 0) - (s.paidAmount || 0) > 0.009) ?? null;
}
