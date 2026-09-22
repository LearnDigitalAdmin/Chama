/**
 * Mirrors the demo's `NAV`, `BOTTOM_NAV`, and `can()` objects exactly (see
 * MyChama_3_1.html's buildNav()/can() functions) so the app's navigation
 * looks and behaves identically per role. All routes below are wired to
 * real screens as of Phase 4 — src/app/ComingSoon.tsx is now unused but
 * left in place as the pattern for any future not-yet-built route.
 */

import type { MemberRole } from '../lib/types';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: string;
}

const ADMIN_ITEMS: Record<string, NavItem> = {
  dashboard: { id: 'dashboard', label: 'Dashboard', path: '/app', icon: 'dashboard' },
  members: { id: 'members', label: 'Members', path: '/app/members', icon: 'members' },
  contributions: { id: 'contributions', label: 'Contributions', path: '/app/contributions', icon: 'contributions' },
  merrygoround: { id: 'merrygoround', label: 'Merry-Go-Round', path: '/app/mgr', icon: 'merrygoround' },
  loans: { id: 'loans', label: 'Loans', path: '/app/loans', icon: 'loans' },
  payments: { id: 'payments', label: 'Payments & Settlement', path: '/app/payments', icon: 'payments' },
  communication: { id: 'communication', label: 'Communication', path: '/app/communication', icon: 'communication' },
  minutes: { id: 'minutes', label: 'Minutes', path: '/app/minutes', icon: 'minutes' },
  reports: { id: 'reports', label: 'Exports', path: '/app/reports', icon: 'reports' },
  billing: { id: 'billing', label: 'Plan & Billing', path: '/app/billing', icon: 'billing' },
  settings: { id: 'settings', label: 'Settings', path: '/app/settings', icon: 'settings' },
};

const MEMBER_ITEMS: Record<string, NavItem> = {
  dashboard: { id: 'dashboard', label: 'Home', path: '/app', icon: 'dashboard' },
  mycontributions: { id: 'mycontributions', label: 'My contributions', path: '/app/contributions', icon: 'mycontributions' },
  mymgr: { id: 'mymgr', label: 'Merry-Go-Round', path: '/app/mgr', icon: 'mymgr' },
  myloans: { id: 'myloans', label: 'My loans', path: '/app/loans', icon: 'myloans' },
  minutes: { id: 'minutes', label: 'Minutes', path: '/app/minutes', icon: 'minutes' },
  messages: { id: 'messages', label: 'Messages', path: '/app/messages', icon: 'messages' },
  settings: { id: 'settings', label: 'Profile', path: '/app/settings', icon: 'settings' },
};

export const NAV: Record<MemberRole, NavItem[]> = {
  chair: [
    ADMIN_ITEMS.dashboard, ADMIN_ITEMS.members, ADMIN_ITEMS.contributions, ADMIN_ITEMS.merrygoround,
    ADMIN_ITEMS.loans, ADMIN_ITEMS.payments, ADMIN_ITEMS.communication, ADMIN_ITEMS.minutes,
    ADMIN_ITEMS.reports, ADMIN_ITEMS.billing, ADMIN_ITEMS.settings,
  ],
  treasurer: [
    ADMIN_ITEMS.dashboard, ADMIN_ITEMS.members, ADMIN_ITEMS.contributions, ADMIN_ITEMS.merrygoround,
    ADMIN_ITEMS.loans, ADMIN_ITEMS.payments, ADMIN_ITEMS.communication, ADMIN_ITEMS.minutes,
    ADMIN_ITEMS.reports, ADMIN_ITEMS.settings,
  ],
  secretary: [
    ADMIN_ITEMS.dashboard, ADMIN_ITEMS.members, ADMIN_ITEMS.contributions, ADMIN_ITEMS.merrygoround,
    ADMIN_ITEMS.loans, ADMIN_ITEMS.communication, ADMIN_ITEMS.minutes, ADMIN_ITEMS.reports, ADMIN_ITEMS.settings,
  ],
  member: [
    MEMBER_ITEMS.dashboard, MEMBER_ITEMS.mycontributions, MEMBER_ITEMS.mymgr, MEMBER_ITEMS.myloans,
    MEMBER_ITEMS.minutes, MEMBER_ITEMS.messages, MEMBER_ITEMS.settings,
  ],
};

export const BOTTOM_NAV: Record<MemberRole, string[]> = {
  chair: ['dashboard', 'members', 'contributions', 'loans'],
  treasurer: ['dashboard', 'contributions', 'loans', 'payments'],
  secretary: ['dashboard', 'members', 'communication', 'minutes'],
  member: ['dashboard', 'mycontributions', 'myloans', 'messages'],
};

const PERMISSIONS: Record<string, MemberRole[]> = {
  manageMembers: ['chair', 'secretary'],
  recordContribution: ['chair', 'treasurer'],
  approveLoan: ['chair', 'treasurer'],
  disburseLoan: ['chair', 'treasurer'],
  sendSms: ['chair', 'secretary'],
  manageSettlement: ['chair', 'treasurer'],
  writeMinutes: ['chair', 'secretary'],
  manageBilling: ['chair'],
  exportData: ['chair', 'treasurer', 'secretary'],
  manageLoanProducts: ['chair', 'treasurer'],
  approveSettlementAccount: ['chair', 'treasurer'],
  manageMgr: ['chair', 'treasurer', 'secretary'],
  drawMgr: ['chair', 'treasurer'],
};

export function can(role: MemberRole | undefined, action: keyof typeof PERMISSIONS): boolean {
  if (!role) return false;
  return (PERMISSIONS[action] || []).includes(role);
}
