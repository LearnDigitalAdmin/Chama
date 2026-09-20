/**
 * Typed wrappers around every mychama1 Cloud Function callable.
 *
 * This file is the FRONTEND HALF of docs/API_CONTRACT.md — the Python
 * backend implements the callables against that same contract. Do not
 * call httpsCallable() directly anywhere else in the app; add the wrapper
 * here first so both sides can never drift on a parameter name.
 *
 * Two flavours, per docs/OFFLINE.md:
 *
 * `callable()` — QUEUEABLE. Goes through src/lib/offlineQueue.ts. If the
 * device is offline (or the call fails for a network reason), the action
 * is queued to IndexedDB and this throws `QueuedOfflineError` instead of
 * returning — catch it specifically to show a "queued, will sync" state:
 *
 *   try {
 *     await recordCashContribution({ ... });
 *   } catch (e) {
 *     if (e instanceof QueuedOfflineError) { showQueuedToast(); return; }
 *     throw e; // a real rejection — handle as before
 *   }
 *
 * Used for actions with server-side idempotency support
 * (functions/shared/idempotency.py) where deferring makes sense: cash
 * recording, disbursement, MGR operations, adding a member. A genuine
 * business rejection still throws the original FunctionsError, unchanged.
 *
 * `liveCallable()` — NOT QUEUEABLE. These need a live round trip by
 * nature (a Paystack STK push, an immediate navigation, live document
 * generation) — silently queuing them would be confusing, not resilient.
 * Throws a clear `OfflineUnavailableError` immediately if there's no
 * connection, rather than pretending to have started something it hasn't.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { callQueued } from './offlineQueue';
import type { ChamaPlan, IntentPurpose, MemberRole } from './types';

export class QueuedOfflineError extends Error {
  queued = true as const;
  constructor(label: string) {
    super(`Queued while offline: ${label}`);
    this.name = 'QueuedOfflineError';
  }
}

export class OfflineUnavailableError extends Error {
  constructor(label: string) {
    super(`${label} needs an internet connection — please try again once you're back online.`);
    this.name = 'OfflineUnavailableError';
  }
}

function callable<Req extends Record<string, unknown>, Res>(name: string, label: (req: Req) => string) {
  return async (data: Req): Promise<Res> => {
    const outcome = await callQueued<Req, Res>(name, data, label(data));
    if (outcome.ok) return outcome.result;
    throw new QueuedOfflineError(label(data));
  };
}

function liveCallable<Req, Res>(name: string, label: string) {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data: Req): Promise<Res> => {
    if (!navigator.onLine) throw new OfflineUnavailableError(label);
    const res = await fn(data);
    return res.data;
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — Identity & Access
// ---------------------------------------------------------------------------

/** Not queueable: the caller is waiting to be navigated into their new chama. */
export const createChama = liveCallable<
  {
    name: string;
    motto?: string;
    contributionAmount: number;
    contributionCycle: 'daily' | 'weekly' | 'monthly';
    adminName: string;
    adminPhone: string;
    adminIdNumber: string;
  },
  { chamaId: string; memberId: string }
>('createChama', 'Creating your chama');

export const addAdmin = callable<
  { chamaId: string; name: string; phone: string; idNumber: string; role: Exclude<MemberRole, 'member'> },
  { memberId: string; inviteId: string }
>('addAdmin', (r) => `Add admin: ${r.name}`);

export const addMember = callable<
  { chamaId: string; name: string; phone: string; idNumber: string },
  { memberId: string; inviteId: string }
>('addMember', (r) => `Add member: ${r.name}`);

/** Not queueable: the caller is waiting to be let into the chama right now. */
export const claimInvite = liveCallable<{ chamaId: string; inviteId: string }, { memberId: string; role: MemberRole }>(
  'claimInvite',
  'Joining the chama'
);

/** Not queueable: same reason as claimInvite. */
export const completeProfile = liveCallable<
  { chamaId?: string; phone: string; idNumber?: string },
  { memberId: string | null }
>('completeProfile', 'Completing your profile');

export const updateMember = callable<
  { chamaId: string; memberId: string; patch: Partial<{ name: string; role: MemberRole; status: 'active' | 'inactive' | 'suspended' }> },
  { ok: true }
>('updateMember', () => 'Update member');

// ---------------------------------------------------------------------------
// Phase 2 — Core operations
//
// Loan APPLICATION and APPROVAL are intentionally absent from this file —
// firestore.rules lets a member create their own pending loan directly
// (schedule computed client-side via src/lib/loanSchedule.ts::buildSchedule)
// and lets the chair/treasurer flip their own approval flag directly — both
// are plain Firestore writes, which already work offline for free via the
// persistent local cache (src/lib/firebase.ts). See
// functions/mychama/loans.py's module docstring for the full reasoning.
// Loan PRODUCTS and MINUTES are likewise direct Firestore writes, not
// callables — see src/features/loans and src/features/minutes.
// ---------------------------------------------------------------------------

export const recordCashContribution = callable<
  { chamaId: string; memberId: string; contributionId: string; amount: number },
  { ok: true; status: string }
>('recordCashContribution', (r) => `Record KES ${r.amount.toLocaleString()} contribution`);

export const disburseLoanCash = callable<{ chamaId: string; loanId: string }, { ok: true }>(
  'disburseLoanCash',
  () => 'Disburse loan (cash)'
);

export const recordCashLoanRepayment = callable<
  { chamaId: string; loanId: string; amount: number },
  { ok: true; remainingOutstanding: number }
>('recordCashLoanRepayment', (r) => `Record KES ${r.amount.toLocaleString()} loan repayment`);

export const createMgrPot = callable<
  {
    chamaId: string;
    name: string;
    amount: number;
    frequency: 'daily' | 'weekly' | 'monthly';
    periodsPerRound: number;
    recipientsPerRound: number;
    memberIds: string[];
  },
  { potId: string }
>('createMgrPot', (r) => `Create merry-go-round: ${r.name}`);

export const runMgrDraw = callable<{ chamaId: string; potId: string; method: 'smart' | 'random' }, { queue: string[] }>(
  'runMgrDraw',
  () => 'Run merry-go-round draw'
);

export const recordCashMgrPayment = callable<
  { chamaId: string; potId: string; memberId: string; amount?: number },
  { ok: true }
>('recordCashMgrPayment', () => 'Record merry-go-round contribution');

export const closeMgrPeriod = callable<
  { chamaId: string; potId: string },
  | { ok: true; roundComplete: false; nextPeriod: number }
  | {
      ok: true;
      roundComplete: true;
      payoutPending: true;
      recipients: string[];
      shareEach: number;
      poolExpected: number;
      poolShortfall: number;
    }
>('closeMgrPeriod', () => 'Close merry-go-round period');

/** Added beyond the original Phase 2 contract — see mychama/mgr.py's docstring. */
export const recordMgrPayoutCash = callable<
  { chamaId: string; potId: string },
  { ok: true; paidTo: string[]; amountEach: number }
>('recordMgrPayoutCash', () => 'Record merry-go-round payout');

// ---------------------------------------------------------------------------
// Phase 3 — Payments, SMS & Settlement
// ---------------------------------------------------------------------------

/** Not queueable: account setup talks to Paystack live and returns a split code the UI needs now. */
export const setupSettlementAccount = liveCallable<
  { chamaId: string; accountLabel: string; accountType: 'paybill' | 'till' | 'bank'; accountNumber?: string; bankCode?: string },
  { settlementSplitCode: string }
>('setupSettlementAccount', 'Setting up settlement account');

export const requestSettlementChange = callable<
  { chamaId: string; accountLabel: string; accountType: 'paybill' | 'till' | 'bank'; accountNumber?: string; bankCode?: string },
  { requestId: string }
>('requestSettlementChange', () => 'Request settlement account change');

export const approveSettlementChange = callable<
  { chamaId: string; requestId: string; decision: 'approve' | 'reject' },
  { ok: true }
>('approveSettlementChange', () => 'Approve settlement account change');

/** Not queueable: triggers a live Paystack STK push to the member's phone right now. */
export const initiatePayment = liveCallable<
  {
    chamaId: string;
    purpose: IntentPurpose;
    amount: number;
    phone: string;
    contributionId?: string;
    loanId?: string;
    potId?: string;
  },
  { reference: string; grossAmount: number; paystackFee: number; ourFee: number }
>('initiatePayment', 'Starting payment');

/** Not queueable: same reason as initiatePayment — live STK push. */
export const purchaseSmsCredits = liveCallable<{ chamaId: string; amountKes: number; phone: string }, { reference: string }>(
  'purchaseSmsCredits',
  'Starting SMS top-up payment'
);

export const sendSmsCampaign = callable<
  { chamaId: string; audience: 'all' | 'overdue' | 'custom'; memberIds?: string[]; message: string },
  { sent: number; creditsUsed: number }
>('sendSmsCampaign', (r) => `Send SMS to ${r.audience}`);

// ---------------------------------------------------------------------------
// Phase 4 — Billing, reports & exports (not yet implemented server-side)
// ---------------------------------------------------------------------------

/** Not queueable: live payment (non-free plans) or an immediate plan change the UI reflects right away. */
export const upgradePlan = liveCallable<
  { chamaId: string; plan: ChamaPlan; phone: string },
  { reference: string } | { ok: true }
>('upgradePlan', 'Changing plan');

/** Not queueable: generates and returns a document URL live. */
export const generateStatement = liveCallable<
  { chamaId: string; memberId?: string; from: string; to: string; format: 'pdf' | 'csv' },
  { url: string }
>('generateStatement', 'Generating statement');
