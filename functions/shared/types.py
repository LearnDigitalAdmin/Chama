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
    smsCredits: NotRequired[float]
    settlementAccount: NotRequired[str]
    settlementSplitCode: NotRequired[str]
    autoSettle: NotRequired[bool]
    settlementFreq: NotRequired[Frequency]
    lastSettlement: NotRequired[str]
    minutesExportsUsedThisMonth: NotRequired[float]
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
    status: Literal["active", "inactive", "suspended"]
    totalContributed: float
    creditBalance: float
    avatarColor: NotRequired[str]
    initial: NotRequired[str]
    whatsappOptIn: NotRequired[bool]
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
    status: Literal["draft", "active", "completed"]
    cycleNumber: int
    period: int
    createdOn: NotRequired[str]
    createdAt: NotRequired[int]
    updatedAt: NotRequired[int]


class MgrRecord(TypedDict):
    id: NotRequired[str]
    period: int
    memberId: str
    status: Literal["paid", "missed", "pending"]
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
