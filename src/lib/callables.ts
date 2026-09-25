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

/**
 * Not queueable: called right after a phone sign-in resolves, so the app
 * can decide whether to route into a chama or show "no chama yet" —
 * queuing it would mean showing the wrong screen while offline.
 *
 * Auto-attaches the caller's uid to any pending member record matching
 * their verified phone number, across every chama, and closes out the
 * matching invite doc. See functions/mychama/identity.py::claimMyInvites —
 * this is what lets a member added by an admin log in and land in their
 * chama with no invite link ever having been sent.
 */
export const claimMyInvites = liveCallable<
  Record<string, never>,
  { claimed: { chamaId: string; chamaName: string; memberId: string; role: MemberRole }[] }
>('claimMyInvites', 'Checking for pending invites');

export const updateMember = callable<
  { chamaId: string; memberId: string; patch: Partial<{ name: string; phone: string; role: MemberRole; status: 'active' | 'inactive' | 'suspended' }> },
  { ok: true }
>('updateMember', () => 'Update member');

export const removeMemberPermanently = callable<{ chamaId: string; memberId: string }, { ok: true }>(
  'removeMemberPermanently',
  () => 'Permanently remove member'
);

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
    exitCutPercent?: number;
    finalRoundPolicy?: 'split' | 'carry_over' | 'close_early';
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
  { chamaId: string; potId: string; acknowledgeShortfall?: boolean },
  { ok: true; paidTo: string[]; amountEach: number }
>('recordMgrPayoutCash', () => 'Record merry-go-round payout');

// -- MGR repair pass — membership, arrears, exits, shortfall, health -------

export const mgrAddMembers = callable<{ chamaId: string; potId: string; memberIds: string[] }, { ok: true; added: string[] }>(
  'mgrAddMembers',
  (r) => `Add ${r.memberIds.length} member(s) to merry-go-round`
);

export const mgrRemoveMember = callable<{ chamaId: string; potId: string; memberId: string }, { ok: true }>(
  'mgrRemoveMember',
  () => 'Remove member from merry-go-round'
);

export const mgrReorderQueue = callable<{ chamaId: string; potId: string; queue: string[] }, { ok: true }>(
  'mgrReorderQueue',
  () => 'Reorder merry-go-round queue'
);

export const mgrToggleAutoDemote = callable<{ chamaId: string; potId: string }, { ok: true; autoDemoteLate: boolean }>(
  'mgrToggleAutoDemote',
  () => 'Toggle auto-demote for late payers'
);

export const mgrSettleArrear = callable<
  { chamaId: string; potId: string; arrearId: string; amount?: number },
  { ok: true; remaining: number }
>('mgrSettleArrear', () => 'Settle merry-go-round arrear');

export const mgrWriteOffArrear = callable<{ chamaId: string; potId: string; arrearId: string; reason: string }, { ok: true }>(
  'mgrWriteOffArrear',
  () => 'Write off merry-go-round arrear'
);

export const mgrCoverShortfall = callable<
  { chamaId: string; potId: string; amount: number; source: 'reserve' | 'member'; memberId?: string },
  { ok: true; remaining: number }
>('mgrCoverShortfall', (r) => `Cover KES ${r.amount.toLocaleString()} merry-go-round shortfall`);

/** Not queueable: the admin is waiting on the computed net figure to decide how to settle. */
export const mgrProposeExit = liveCallable<
  { chamaId: string; potId: string; memberId: string },
  { exitId: string; proposedNet: number; grossNet: number }
>('mgrProposeExit', 'Working out exit settlement');

export const mgrSettleExit = callable<
  { chamaId: string; potId: string; exitId: string; settledAmount?: number },
  { ok: true; settledAmount: number; settledDirection: 'pot_to_member' | 'member_to_pot' }
>('mgrSettleExit', () => 'Settle merry-go-round exit');

export const mgrRepairPot = callable<{ chamaId: string; potId: string }, { ok: true; changed: boolean; queue: string[] }>(
  'mgrRepairPot',
  () => 'Repair merry-go-round pot'
);

export const mgrCloseForever = callable<{ chamaId: string; potId: string }, { ok: true }>(
  'mgrCloseForever',
  () => 'Close merry-go-round pot'
);

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

/**
 * Not queueable: triggers a live Paystack STK push right now.
 *
 * Self-pay (default): omit `memberId`; `phone` is required, same as
 * before this change.
 *
 * Admin-on-behalf-of-member charge: pass `memberId` for a member other
 * than the caller (finance-admin only — see functions/mychama/payments.py).
 * `phone` is ignored in that case; the server defaults to the target
 * member's phone on file, or — pass `overridePhone` to send the STK
 * prompt to a different number instead (e.g. a spouse/agent paying on
 * the member's behalf). This is what
 * src/features/payments/AdminChargeButton.tsx calls, shared across
 * Contributions and MGR admin screens.
 */
export const initiatePayment = liveCallable<
  {
    chamaId: string;
    purpose: IntentPurpose;
    amount: number;
    phone?: string;
    memberId?: string;
    overridePhone?: string;
    contributionId?: string;
    loanId?: string;
    installmentNo?: number;
    potId?: string;
    potPeriod?: number;
  },
  { reference: string; grossAmount: number; paystackFee: number; ourFee: number }
>('initiatePayment', 'Starting payment');

/** Not queueable: same reason as initiatePayment — live STK push. */
export const purchaseSmsCredits = liveCallable<{ chamaId: string; amountKes: number; phone: string }, { reference: string }>(
  'purchaseSmsCredits',
  'Starting SMS top-up payment'
);

export const sendSmsCampaign = callable<
  { chamaId: string; audience: 'all' | 'overdue' | 'custom' | 'loan_holders' | 'admins'; memberIds?: string[]; message: string },
  { sent: number; creditsUsed: number }
>('sendSmsCampaign', (r) => `Send SMS to ${r.audience}`);

// ---------------------------------------------------------------------------
// Phase 4 — Billing, reports & exports
// ---------------------------------------------------------------------------

/** Not queueable: live payment (non-free plans) or an immediate plan change the UI reflects right away. */
export const upgradePlan = liveCallable<
  { chamaId: string; plan: ChamaPlan; phone: string },
  { reference: string } | { ok: true }
>('upgradePlan', 'Changing plan');

/**
 * Not queueable: generates and returns a document URL live.
 * Either a date-ranged statement (from/to/format, memberId optional for a
 * whole-chama statement) OR — a small, documented addition beyond the
 * original contract, see TOUCH_BASE.md "Billing & statements" — a single
 * minutes entry's PDF via minutesId, which ignores from/to/memberId.
 */
export const generateStatement = liveCallable<
  { chamaId: string; memberId?: string; from?: string; to?: string; format: 'pdf' | 'csv'; minutesId?: string; potId?: string },
  { url: string }
>('generateStatement', 'Generating statement');
