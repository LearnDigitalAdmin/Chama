/**
 * MyChama Shared Types (Frontend / TypeScript)
 *
 * Canonical mirror of:
 *   - CYBER/functions/src/types/mychama.types.ts (the WhatsApp bot's copy)
 *   - functions/shared/types.py (this repo, Python backend)
 *   - firestoreData.json (root of this repo — the schema contract)
 *
 * If you change a field here, change it in all three, in the same commit.
 * This file additionally documents a few fields/collections that exist only
 * because the app (not the bot) needs them — each is marked "APP-ONLY".
 */

export type ChamaPlan = 'free' | 'starter' | 'basic' | 'growth' | 'max';
export type MemberRole = 'chair' | 'treasurer' | 'secretary' | 'member';
export type PayMethod = 'paystack' | 'manual' | null;

export interface Chama {
  id: string;
  name: string;
  motto?: string;
  plan: ChamaPlan;
  planExpiry?: string;
  autoRenew?: boolean;
  contributionAmount: number;
  contributionCycle: 'daily' | 'weekly' | 'monthly';
  /** What the chama already had banked before joining the app. Set at creation
   *  (defaults to 0); afterwards only the treasurer may change it — see
   *  firestore.rules and AdminDashboard's Group balance calculation. */
  openingBalance?: number;
  smsCredits?: number;
  settlementAccount?: string;
  settlementSplitCode?: string;
  autoSettle?: boolean;
  settlementFreq?: 'daily' | 'weekly' | 'monthly';
  lastSettlement?: string;
  minutesExportsUsedThisMonth?: number;
  status: 'active' | 'suspended';
  whatsappEnabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface ChamaMember {
  id: string;
  memberId: string;
  chamaId?: string;
  uid?: string | null;
  name: string;
  phone: string;
  phoneNormalized: string;
  role: MemberRole;
  isAdmin: boolean;
  /** SENSITIVE. Only present when read by a finance admin or the member themself — see firestore.rules. */
  idNumber?: string;
  idLast4: string;
  nationalIdMasked: string;
  joinDate: string;
  status: 'active' | 'inactive' | 'suspended' | 'removed';
  totalContributed: number;
  creditBalance: number;
  avatarColor?: string;
  initial?: string;
  whatsappOptIn?: boolean;
  removedAt?: number;
  removedBy?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface LoanProduct {
  id: string;
  name: string;
  type: 'flat' | 'reducing';
  rate: number;
  maxAmount: number;
  maxTerm: number;
  desc: string;
  active: boolean;
}

export type ContributionStatus = 'pending' | 'partial' | 'paid' | 'overdue';

export interface Contribution {
  id: string;
  memberId: string;
  period: string;
  periodKey: string;
  amount: number;
  paidAmount: number;
  status: ContributionStatus;
  method: PayMethod;
  paidOn: string | null;
  ref: string | null;
  dueDate?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface LoanInstallment {
  n: number;
  due: number;
  principalPart: number;
  interestPart: number;
  opening: number;
  closing: number;
  paid: boolean;
  paidAmount: number;
  dueDate: string;
}

export type LoanStatus =
  | 'pending_approval'
  | 'awaiting_treasurer'
  | 'approved'
  | 'active'
  | 'overdue'
  | 'completed'
  | 'rejected';

export interface Loan {
  id: string;
  memberId: string;
  productId: string;
  principal: number;
  term: number;
  purpose?: string;
  status: LoanStatus;
  approvals: { chair: boolean; treasurer: boolean };
  requestedOn: string;
  disbursedOn: string | null;
  method: PayMethod;
  installment: number;
  totalInterest: number;
  totalPay: number;
  schedule: LoanInstallment[];
  source?: 'app' | 'whatsapp';
  createdAt?: number;
  updatedAt?: number;
}

export interface MgrPot {
  id: string;
  name: string;
  amount: number;
  frequency: 'daily' | 'weekly' | 'monthly';
  periodsPerRound: number;
  recipientsPerRound: number;
  memberIds: string[];
  queue: string[];
  drawDone: boolean;
  drawMethod: 'smart' | 'random' | null;
  autoDemoteLate: boolean;
  /** % withheld from a departing member's refund on exit (0 = none). Never applied to what a member owes the pot. */
  exitCutPercent?: number;
  /** How a round that can't split evenly across recipientsPerRound is handled — chosen at creation. 'carry_over' pays everyone their full standard share then starts a new cycle automatically; 'close_early' pays the same full share then rests as 'completed'; 'split' (default) divides whatever's collected evenly among who's left. */
  finalRoundPolicy?: 'split' | 'carry_over' | 'close_early';
  status: 'draft' | 'active' | 'completed' | 'closed';
  cycleNumber: number;
  period: number;
  /** Carried from the last closeMgrPeriod — what the round fell short by. Cleared by mgrCoverShortfall / paid out. */
  pendingShortfall?: number;
  remindersEnabled?: boolean;
  reminderScheduleId?: string | null;
  closedAt?: number | null;
  createdOn: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface MgrArrear {
  id: string;
  memberId: string;
  periods: number[];
  amount: number;
  status: 'open' | 'settled' | 'written_off';
  settledAmount?: number;
  writeOffReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MgrExit {
  id: string;
  memberId: string;
  reason: string;
  contributed: number;
  received: number;
  exitCutPercent: number;
  cutAmount: number;
  refundDue: number;
  refundPaid: number;
  clawbackDue: number;
  clawbackRecovered: number;
  status: 'open' | 'settled';
  createdAt: number;
  updatedAt: number;
}

export type MgrLedgerKind =
  | 'contribution'
  | 'payout'
  | 'arrear_opened'
  | 'arrear_settled'
  | 'arrear_written_off'
  | 'shortfall_recorded'
  | 'shortfall_covered'
  | 'member_added'
  | 'member_removed'
  | 'member_exited'
  | 'exit_refund_paid'
  | 'exit_recovered'
  | 'exit_settled'
  | 'queue_reordered'
  | 'period_closed'
  | 'pot_closed'
  | 'repaired'
  | 'cycle_started';

export interface MgrLedgerEntry {
  id: string;
  kind: MgrLedgerKind;
  memberId?: string | null;
  amount?: number;
  note?: string;
  createdAt: number;
}

export interface MgrRecord {
  id: string;
  period: number;
  memberId: string;
  status: 'paid' | 'missed' | 'pending';
  amount: number;
  date: string | null;
  method: PayMethod;
  ref?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface MgrPayout {
  id: string;
  memberId: string;
  round: number;
  amount: number;
  date: string;
  method: PayMethod;
  ref?: string | null;
  paystackFee?: number;
  ourFee?: number;
  createdAt?: number;
}

export type TransactionType =
  | 'contribution'
  | 'loan_disbursement'
  | 'loan_repayment'
  | 'mgr_contribution'
  | 'mgr_payout';

export interface ChamaTransaction {
  id: string;
  type: TransactionType;
  memberId: string;
  amount: number;
  grossAmount?: number;
  paystackFee?: number;
  ourFee?: number;
  method: PayMethod;
  ref: string;
  date: string;
  settled: boolean;
  direction: 'in' | 'out';
  note?: string;
  channel?: 'app' | 'whatsapp';
  /** paymentIntents document ID when the payment originated on WhatsApp or the app. */
  intentId?: string;
  /** Set on mgr_contribution / mgr_payout / shortfall-cover / exit-settlement rows so a statement can be scoped to one pot. */
  potId?: string | null;
  createdAt?: number;
}

/** Result of the gross-up calculation quoted to a member before they pay. */
export interface FeeBreakdown {
  net: number;
  gross: number;
  paystackFee: number;
  ourFee: number;
}

export type IntentPurpose = 'contribution' | 'loan_repayment' | 'mgr_contribution';
export type IntentStatus = 'pending' | 'success' | 'failed' | 'abandoned' | 'expired';
/** APP-ONLY addition: the bot's intents are always 'whatsapp'; the app's are always 'app'. */
export type IntentChannel = 'whatsapp' | 'app';

/**
 * A payment intent is the ONLY financial document either the bot or the app
 * writes for money coming IN. It records what the member asked to pay and
 * the exact fee split quoted to them. The single Paystack webhook (PAY repo)
 * is what actually credits contributions, loans and pots — so an outage on
 * either channel can never leave money unaccounted for, and a replayed
 * webhook can never double-credit (reference is the idempotency key).
 */
export interface PaymentIntent {
  id: string;
  chamaId: string;
  memberId: string;
  purpose: IntentPurpose;
  reference: string;
  amount: number;
  grossAmount: number;
  paystackFee: number;
  ourFee: number;
  currency: 'KES';
  phone: string;
  provider: 'mpesa' | 'airtel';
  status: IntentStatus;
  channel: IntentChannel;
  contributionId?: string;
  loanId?: string;
  installmentNo?: number;
  potId?: string;
  potPeriod?: number;
  splitCode: string;
  paystackMessage?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

/** APP-ONLY. userChamas/{uid}/memberships/{chamaId} — rules-support index & "my chamas" list. */
export interface UserChamaMembership {
  chamaId: string;
  chamaName: string;
  memberId: string;
  role: MemberRole;
  status: 'active' | 'inactive' | 'suspended';
  updatedAt?: number;
}

/**
 * APP-ONLY, new for live implementation (not in the original demo).
 * chamas/{chamaId}/invites/{inviteId} — lets a finance admin add a member
 * before they've ever authenticated. See docs/ARCHITECTURE.md
 * "Invite & claim flow".
 */
export interface Invite {
  id: string;
  chamaId: string;
  memberId: string;
  phone: string;
  role: MemberRole;
  status: 'pending' | 'claimed' | 'revoked' | 'expired';
  createdBy: string;
  createdAt: number;
  claimedAt?: number;
  claimedByUid?: string;
  expiresAt: number;
}

export interface Minute {
  id: string;
  title: string;
  date: string;
  venue?: string;
  chairPresent?: boolean;
  attendees: string[];
  agenda: string[];
  resolutions: string[];
  aob?: string;
  nextMeeting?: string;
  recordedBy: string;
  createdAt?: number;
}

export interface SettlementAccountRequest {
  id: string;
  requestedBy: string;
  accountLabel: string;
  accountType: 'paybill' | 'till' | 'bank';
  accountNumber?: string;
  bankCode?: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy: string | null;
  createdAt?: number;
  updatedAt?: number;
}

/** APP-ONLY, Phase 4. chamas/{chamaId}/smsLog/{id} — one campaign send. The
 * Messages screen (member) filters this by recipientIds to build an inbox;
 * it also doubles as an in-app fallback if the SMS itself failed to land. */
export interface SmsLogEntry {
  id: string;
  audience: 'all' | 'overdue' | 'custom' | 'loan_holders' | 'admins';
  message: string;
  recipientIds: string[];
  recipientCount: number;
  sentCount: number;
  creditsUsed: number;
  sentBy: string;
  createdAt: number;
}

/** chamas/{chamaId}/smsSchedules/{id} — a client-written doc (see firestore.rules'
 * smsSchedules match block), dispatched by functions/mychama/sms.py's
 * run_sms_schedules cron. Field names must match that cron exactly:
 * `status`/`body`, not `active`/`message`. */
export interface SmsSchedule {
  id: string;
  status: 'active' | 'paused';
  body: string;
  audience: 'all' | 'overdue' | 'custom' | 'loan_holders' | 'admins';
  memberIds?: string[] | null;
  frequency: 'daily' | 'weekly' | 'monthly';
  /** Epoch ms — the cron picks up anything with nextRun <= now. */
  nextRun: number;
  /** Set only for a reminder schedule created from a specific MGR pot (see MgrPotDetail.tsx). */
  potId?: string | null;
  createdAt?: number;
}

/** APP-ONLY, Phase 4. chamas/{chamaId}/planBilling/{reference} — a plan
 * payment, pending until the PAY repo's webhook settles it (mirrors
 * PaymentIntent/smsTopUps exactly — see functions/mychama/billing.py). */
export interface PlanBillingRecord {
  id: string;
  chamaId: string;
  fromPlan: ChamaPlan;
  toPlan: ChamaPlan;
  amountKes: number;
  phone: string;
  status: 'pending' | 'success' | 'failed';
  requestedBy: string;
  createdAt: number;
  updatedAt?: number;
  expiresAt: number;
}
