/**
 * Firestore path builders — mirrors functions/shared/firestore_paths.py
 * (this repo) and CYBER's `mcPath` object. Keeps string concatenation out
 * of every component/hook so a path never drifts between modules.
 */

import { MC } from './constants';

export const paths = {
  chama: (chamaId: string) => `${MC.CHAMAS}/${chamaId}`,

  members: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.MEMBERS}`,
  member: (chamaId: string, memberId: string) => `${MC.CHAMAS}/${chamaId}/${MC.MEMBERS}/${memberId}`,

  loanProducts: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.LOAN_PRODUCTS}`,
  loanProduct: (chamaId: string, productId: string) => `${MC.CHAMAS}/${chamaId}/${MC.LOAN_PRODUCTS}/${productId}`,

  contributions: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.CONTRIBUTIONS}`,
  contribution: (chamaId: string, contributionId: string) =>
    `${MC.CHAMAS}/${chamaId}/${MC.CONTRIBUTIONS}/${contributionId}`,

  loans: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.LOANS}`,
  loan: (chamaId: string, loanId: string) => `${MC.CHAMAS}/${chamaId}/${MC.LOANS}/${loanId}`,

  transactions: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.TRANSACTIONS}`,

  mgrPots: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.MGR_POTS}`,
  mgrPot: (chamaId: string, potId: string) => `${MC.CHAMAS}/${chamaId}/${MC.MGR_POTS}/${potId}`,
  mgrRecords: (chamaId: string, potId: string) => `${MC.CHAMAS}/${chamaId}/${MC.MGR_POTS}/${potId}/${MC.MGR_RECORDS}`,
  mgrRecord: (chamaId: string, potId: string, recordId: string) =>
    `${MC.CHAMAS}/${chamaId}/${MC.MGR_POTS}/${potId}/${MC.MGR_RECORDS}/${recordId}`,
  mgrPayouts: (chamaId: string, potId: string) => `${MC.CHAMAS}/${chamaId}/${MC.MGR_POTS}/${potId}/${MC.MGR_PAYOUTS}`,

  paymentIntents: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.PAYMENT_INTENTS}`,
  paymentIntent: (chamaId: string, reference: string) => `${MC.CHAMAS}/${chamaId}/${MC.PAYMENT_INTENTS}/${reference}`,

  smsTopups: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.SMS_TOPUPS}`,
  smsTopup: (chamaId: string, reference: string) => `${MC.CHAMAS}/${chamaId}/${MC.SMS_TOPUPS}/${reference}`,

  planBilling: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.PLAN_BILLING}`,
  minutes: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.MINUTES}`,
  settlements: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.SETTLEMENTS}`,
  settlementAccountRequests: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.SETTLEMENT_ACCOUNT_REQUESTS}`,
  smsLog: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.SMS_LOG}`,
  smsSchedules: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.SMS_SCHEDULES}`,
  invites: (chamaId: string) => `${MC.CHAMAS}/${chamaId}/${MC.INVITES}`,

  userChamaMembership: (uid: string, chamaId: string) => `${MC.USER_CHAMAS}/${uid}/${MC.MEMBERSHIPS}/${chamaId}`,
  userChamaMemberships: (uid: string) => `${MC.USER_CHAMAS}/${uid}/${MC.MEMBERSHIPS}`,
};
