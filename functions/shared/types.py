"""
MyChama Shared Types (Python / Cloud Functions)

TypedDict mirrors of every Firestore document in firestoreData.json and of
CYBER/functions/src/types/mychama.types.ts. These are structural hints for
editors/type-checkers (Firestore SDK still returns plain dicts) — they are
NOT validated at runtime. Use functions/shared/validation.py for that.

If you add or rename a field here, mirror the change in:
  - src/lib/types.ts
  - firestoreData.json (root of this repo)
  - firestore.rules (if the field affects who may write it)
"""

from __future__ import annotations

from typing import Literal, Optional, TypedDict, List, Dict, NotRequired

ChamaPlan = Literal["free", "starter", "basic", "growth", "max"]
MemberRole = Literal["chair", "treasurer", "secretary", "member"]
PayMethod = Optional[Literal["paystack", "manual"]]
ContributionStatus = Literal["pending", "partial", "paid", "overdue"]
LoanStatus = Literal[
    "pending_approval",
    "awaiting_treasurer",
    "approved",
    "active",
    "overdue",
    "completed",
    "rejected",
]
LoanType = Literal["flat", "reducing"]
Frequency = Literal["daily", "weekly", "monthly"]
TransactionType = Literal[
    "contribution",
    "loan_disbursement",
    "loan_repayment",
    "mgr_contribution",
    "mgr_payout",
]
IntentPurpose = Literal["contribution", "loan_repayment", "mgr_contribution"]
IntentStatus = Literal["pending", "success", "failed", "abandoned", "expired"]
IntentChannel = Literal["whatsapp", "app"]
Provider = Literal["mpesa", "airtel"]


class Chama(TypedDict):
    id: NotRequired[str]
    name: str
    motto: NotRequired[str]
    plan: ChamaPlan
    planExpiry: NotRequired[str]
    autoRenew: NotRequired[bool]
    contributionAmount: float
    contributionCycle: Frequency
    # What the chama already had banked before joining the app. Set once at
    # createChama (defaults to 0); afterwards only the treasurer may change
    # it (see firestore.rules) — everything else the Group balance figure
    # reflects comes from the transactions ledger, not from client writes.
    openingBalance: NotRequired[float]
    smsCredits: NotRequired[float]
    settlementAccount: NotRequired[str]
    settlementSplitCode: NotRequired[str]
    autoSettle: NotRequired[bool]
    settlementFreq: NotRequired[Frequency]
    lastSettlement: NotRequired[str]
    # --- Reports engine (retires minutesExportsUsedThisMonth/minutesQuota —
    #     see functions/shared/constants.py's PLANS docstring). A chama
    #     provisioned before this patch has the OLD field instead; every
    #     reader falls back to it — see reports_engine.standard_used(). ---
    minutesExportsUsedThisMonth: NotRequired[float]  # LEGACY — pre-reports-engine name, read as a fallback only
    standardReportsUsedThisMonth: NotRequired[float]
    premiumReportsUsedThisMonth: NotRequired[float]
    premiumAlacarteUsedThisMonth: NotRequired[int]
    # Prepaid top-up wallet — spent as STANDARD credits on Starter/Basic,
    # or PREMIUM credits on Growth/Max (see constants.py). Credited by the
    # PAY repo's webhook on an MCX- reference succeeding.
    reportCreditsBalance: NotRequired[float]
    # 1-12; which month a chama's financial year starts (for the P&L /
    # Balance Sheet "This/Last Financial Year" period presets). Defaults to
    # 1 (January) when absent.
    fiscalYearStartMonth: NotRequired[int]
    status: Literal["active", "suspended"]
    whatsappEnabled: NotRequired[bool]
    createdAt: NotRequired[int]
    updatedAt: NotRequired[int]


class ChamaMember(TypedDict):
    id: NotRequired[str]
    memberId: NotRequired[str]
    chamaId: NotRequired[str]
    uid: Optional[str]
    name: str
    phone: str
    phoneNormalized: str
    role: MemberRole
    isAdmin: bool
    idNumber: str            # SENSITIVE — never return to a non-finance-admin client
    idLast4: str
    nationalIdMasked: NotRequired[str]
    joinDate: NotRequired[str]
    status: Literal["active", "inactive", "suspended", "removed"]
    totalContributed: float
    creditBalance: float
    avatarColor: NotRequired[str]
    initial: NotRequired[str]
    whatsappOptIn: NotRequired[bool]
    removedAt: NotRequired[int]
    removedBy: NotRequired[str]
    createdAt: NotRequired[int]
    updatedAt: NotRequired[int]


class LoanProduct(TypedDict):
    id: NotRequired[str]
    name: str
    type: LoanType
    rate: float
    maxAmount: float
    maxTerm: int
    desc: NotRequired[str]
    active: bool


class Contribution(TypedDict):
    id: NotRequired[str]
    memberId: str
    period: str
    periodKey: str            # YYYY-MM — every ordering / range query relies on this
    amount: float
    paidAmount: float
    status: ContributionStatus
    method: PayMethod
    paidOn: Optional[str]
    ref: Optional[str]
    dueDate: NotRequired[str]
    createdAt: NotRequired[int]
    updatedAt: NotRequired[int]


class LoanInstallment(TypedDict):
    n: int
    due: float
    principalPart: float
    interestPart: float
    opening: float
    closing: float
    paid: bool
    paidAmount: float
    dueDate: str


class LoanApprovals(TypedDict):
    chair: bool
    treasurer: bool


class Loan(TypedDict):
    id: NotRequired[str]
    memberId: str
    productId: str
    principal: float
    term: int
    purpose: NotRequired[str]
    status: LoanStatus
    approvals: LoanApprovals
    requestedOn: str
    disbursedOn: Optional[str]
    method: PayMethod
    installment: float
    totalInterest: float
    totalPay: float
    schedule: List[LoanInstallment]
    source: Literal["app", "whatsapp"]
    createdAt: NotRequired[int]
    updatedAt: NotRequired[int]


class MgrPot(TypedDict):
    id: NotRequired[str]
    name: str
    amount: float
    frequency: Frequency
    periodsPerRound: int
    recipientsPerRound: int
    memberIds: List[str]
    queue: List[str]
    drawDone: bool
    drawMethod: Optional[Literal["smart", "random"]]
    autoDemoteLate: bool
    status: Literal["draft", "active", "completed", "closed"]
    cycleNumber: int
    period: int
    # pending shortfall carried from the last closeMgrPeriod on this pot —
    # set when the round's collected total falls short of the promised
    # payout, cleared/decremented by recordMgrShortfallCover. Surfaced to
    # admins to chase rather than quietly absorbed. See mgr_engine.py.
    pendingShortfall: NotRequired[float]
    remindersEnabled: NotRequired[bool]
    reminderScheduleId: NotRequired[Optional[str]]
    closedAt: NotRequired[Optional[int]]
    createdOn: NotRequired[str]
    createdAt: NotRequired[int]
    updatedAt: NotRequired[int]


class MgrArrear(TypedDict):
    """chamas/{c}/mgrPots/{p}/arrears/{id} — one open running balance per
    member per pot, opened automatically the first time closeMgrPeriod
    marks them missed, topped up by every subsequent miss."""
    id: NotRequired[str]
    memberId: str
    periods: List[int]           # periods this arrear covers
    amount: float                # outstanding balance
    status: Literal["open", "settled", "written_off"]
    settledAmount: NotRequired[float]
    writeOffReason: NotRequired[str]
    createdAt: int
    updatedAt: int


class MgrExit(TypedDict):
    """chamas/{c}/mgrPots/{p}/exits/{id} — a member removed from the pot
    mid-cycle. Unlike a plain mgrRemoveMember, this member had money on
    the table (paid in, or already received a payout, or both), so they
    leave the pot IMMEDIATELY (mgrExitMember) while what's owed is tracked
    as two independent running balances, each settled over one or more
    partial payments — refundDue/refundPaid (the pot owes them, net of
    the exit cut %) and clawbackDue/clawbackRecovered (they owe the pot,
    from payouts already received). 'open' until BOTH balances reach
    zero."""
    id: NotRequired[str]
    memberId: str
    reason: str
    contributed: float           # paid in this cycle, before the cut
    received: float               # payouts already received this cycle
    exitCutPercent: float
    cutAmount: float
    refundDue: float
    refundPaid: float
    clawbackDue: float
    clawbackRecovered: float
    status: Literal["open", "settled"]
    createdAt: int
    updatedAt: int


class MgrLedgerEntry(TypedDict):
    """chamas/{c}/mgrPots/{p}/ledger/{id} — append-only log of every
    money-moving or membership-changing event on the pot, independent of
    the main chama transactions collection. This is what lets a pot be
    audited/repaired on its own, and is the source for per-pot statements."""
    id: NotRequired[str]
    kind: Literal[
        "contribution", "payout", "arrear_opened", "arrear_settled",
        "arrear_written_off", "shortfall_recorded", "shortfall_covered",
        "member_added", "member_removed", "member_exited",
        "exit_refund_paid", "exit_recovered", "exit_settled",
        "queue_reordered", "period_closed", "pot_closed", "repaired",
        "cycle_started",
    ]
    memberId: NotRequired[Optional[str]]
    amount: NotRequired[float]
    note: NotRequired[str]
    createdAt: int


class MgrRecord(TypedDict):
    id: NotRequired[str]
    period: int
    memberId: str
    # 'partial' — a cash payment less than the pot's full per-period amount
    # was recorded; the shortfall is tracked as an arrear exactly like a
    # full miss (see closeMgrPeriod). Only 'paid' counts as fully honored
    # for late_score/reliability purposes.
    status: Literal["paid", "partial", "missed", "pending"]
    amount: float
    date: Optional[str]
    method: PayMethod
    ref: NotRequired[Optional[str]]
    createdAt: NotRequired[int]
    updatedAt: NotRequired[int]


class MgrPayout(TypedDict):
    id: NotRequired[str]
    memberId: str
    round: int
    # The pot's cycleNumber at the moment this payout was made. Lets a
    # later health check / repair tell "already paid out THIS cycle"
    # (correctly absent from the queue) apart from "paid out in a PRIOR
    # cycle, now back in the queue after mgrStartNewCycle" (genuinely
    # missing). Absent on payouts written before this field existed —
    # treat those as cycle 1.
    cycleNumber: NotRequired[int]
    amount: float
    date: str
    method: PayMethod
    ref: NotRequired[Optional[str]]
    paystackFee: NotRequired[float]
    ourFee: NotRequired[float]
    createdAt: NotRequired[int]


class ChamaTransaction(TypedDict):
    id: NotRequired[str]
    type: TransactionType
    memberId: str
    amount: float
    grossAmount: NotRequired[float]
    paystackFee: NotRequired[float]
    ourFee: NotRequired[float]
    method: Literal["paystack", "manual"]
    ref: str
    date: str
    settled: bool
    direction: Literal["in", "out"]
    note: NotRequired[str]
    channel: Literal["app", "whatsapp"]
    intentId: NotRequired[str]
    # Set on every mgr_contribution / mgr_payout / mgr_shortfall_cover /
    # mgr_exit_settlement row so generateStatement can scope a statement to
    # one pot without string-matching `note`. See functions/mychama/mgr.py.
    potId: NotRequired[Optional[str]]
    createdAt: NotRequired[int]


class FeeBreakdown(TypedDict):
    net: float
    gross: float
    paystackFee: float
    ourFee: float


class PaymentIntent(TypedDict):
    id: NotRequired[str]
    chamaId: str
    memberId: str
    purpose: IntentPurpose
    reference: str
    amount: float          # NET — what must reach the chama
    grossAmount: float     # what the member is actually charged
    paystackFee: float
    ourFee: float
    currency: Literal["KES"]
    phone: str
    provider: Provider
    status: IntentStatus
    channel: IntentChannel
    # Set when a finance admin charging on another member's behalf typed a
    # different number than the one on file (e.g. a spouse's or agent's
    # phone). Audit trail only — never changes who the charge is recorded
    # against. See functions/mychama/payments.py::initiatePayment.
    phoneOverridden: NotRequired[bool]
    memberPhoneOnFile: NotRequired[Optional[str]]
    contributionId: NotRequired[Optional[str]]
    loanId: NotRequired[Optional[str]]
    installmentNo: NotRequired[Optional[int]]
    potId: NotRequired[Optional[str]]
    potPeriod: NotRequired[Optional[int]]
    splitCode: str
    paystackMessage: NotRequired[str]
    createdAt: int
    updatedAt: int
    expiresAt: int


class UserChamaMembership(TypedDict):
    chamaId: str
    chamaName: str
    memberId: str
    role: MemberRole
    status: Literal["active", "inactive", "suspended"]
    updatedAt: NotRequired[int]


class Invite(TypedDict):
    """
    New collection (added for live implementation — not in the original demo).
    chamas/{chamaId}/invites/{inviteId}
    Lets a finance admin add a member/admin who has not yet authenticated,
    and lets that person's first sign-in (phone, Google, or email) claim the
    matching member document instead of creating a duplicate. See
    docs/ARCHITECTURE.md "Invite & claim flow".
    """
    id: NotRequired[str]
    chamaId: str
    memberId: str            # the member doc this invite claims, pre-created with uid=None
    phone: str
    role: MemberRole
    status: Literal["pending", "claimed", "revoked", "expired"]
    createdBy: str            # memberId of the inviting admin
    createdAt: int
    claimedAt: NotRequired[int]
    claimedByUid: NotRequired[str]
    expiresAt: int


class ReportCreditTopUp(TypedDict):
    """
    chamas/{chamaId}/reportCreditTopUps/{reference} — reports-engine wallet
    top-up. Same shape/trust model as SmsTopUp (doc ID IS the payment
    reference, prefix MCX-), settled by the PAY repo's webhook — see
    functions/mychama/reports.py::purchaseReportCredits and TOUCH_BASE.md
    "Reports engine — PAY-repo follow-up".
    """
    chamaId: str
    credits: int              # how many wallet credits this purchase adds on success
    amountKes: float
    phone: str
    status: Literal["pending", "success", "failed"]
    createdAt: int
    expiresAt: int
    updatedAt: NotRequired[int]


class ReportAlacartePurchase(TypedDict):
    """
    chamas/{chamaId}/reportAlacartePurchases/{reference} — Starter/Basic
    one-off premium-report purchase (prefix MCR-). The report's parameters
    are captured at purchase time so `generateReport` can find and consume
    this doc once payment succeeds, without the caller having to resend
    them. Counts against `chamas.premiumAlacarteUsedThisMonth` from the
    moment it's CREATED (not from success) so a chama can't get around its
    monthly cap by leaving several payments pending at once.
    """
    chamaId: str
    reportType: str            # one of REPORT_TYPES' premium keys (cashflow / profit_loss / balance_sheet)
    memberId: NotRequired[str]
    dateFrom: NotRequired[str]
    dateTo: NotRequired[str]
    asOf: NotRequired[str]
    format: Literal["pdf", "csv"]
    encrypt: bool
    amountKes: float
    phone: str
    status: Literal["pending", "success", "failed", "consumed"]
    createdAt: int
    expiresAt: int
    updatedAt: NotRequired[int]
