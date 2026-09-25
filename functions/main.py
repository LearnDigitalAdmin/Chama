"""
Cloud Functions entry point for the mychama1 Firebase project.

Deployed functions must be importable names at THIS module's top level, so
every submodule under mychama/ is imported explicitly and re-exported here
rather than left to be discovered indirectly.
"""

from firebase_functions.options import set_global_options
from firebase_admin import initialize_app

# For cost control — see the Firebase Functions docs for max_instances.
set_global_options(max_instances=10)

initialize_app()

# --- Phase 1: Identity & Access -------------------------------------------
from mychama.identity import (  # noqa: E402,F401
    createChama,
    addAdmin,
    addMember,
    claimInvite,
    claimMyInvites,
    completeProfile,
    updateMember,
    removeMemberPermanently,
)
from mychama.triggers import on_member_write  # noqa: E402,F401

# --- Phase 2: Core Chama Operations ----------------------------------------
from mychama.contributions import (  # noqa: E402,F401
    recordCashContribution,
    open_contribution_cycles,
    sweep_overdue_contributions,
)
from mychama.loans import (  # noqa: E402,F401
    disburseLoanCash,
    recordCashLoanRepayment,
    sweep_overdue_loans,
    on_loan_write,
)
from mychama.mgr import (  # noqa: E402,F401
    createMgrPot,
    runMgrDraw,
    recordCashMgrPayment,
    closeMgrPeriod,
    recordMgrPayoutCash,
    mgrAddMembers,
    mgrRemoveMember,
    mgrReorderQueue,
    mgrToggleAutoDemote,
    mgrSettleArrear,
    mgrWriteOffArrear,
    mgrCoverShortfall,
    mgrProposeExit,
    mgrSettleExit,
    mgrRepairPot,
    mgrCloseForever,
)

# --- Phase 3: Payments, SMS & Settlement -----------------------------------
from mychama.payments import (  # noqa: E402,F401
    setupSettlementAccount,
    requestSettlementChange,
    approveSettlementChange,
    initiatePayment,
)
from mychama.sms import (  # noqa: E402,F401
    sendSmsCampaign,
    purchaseSmsCredits,
    run_sms_schedules,
)

# --- Phase 4: Billing, Reports & Exports -----------------------------------
from mychama.billing import (  # noqa: E402,F401
    upgradePlan,
    generateStatement,
    sweep_plan_expiry,
    reset_monthly_export_quota,
)
