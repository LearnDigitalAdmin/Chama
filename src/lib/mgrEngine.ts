/**
 * NEW IN PHASE 2 — read-only mirror of functions/shared/mgr_engine.py, for
 * rendering figures like "% on-time" in the UI. The WRITE path (drawing,
 * closing a period) only ever runs server-side, in the callables in
 * functions/mychama/mgr.py — nothing here mutates a queue or a record.
 */

import type { MgrArrear, MgrPayout, MgrPot, MgrRecord } from './types';

const LATE_DECAY = 0.7;

export function lateScore(records: MgrRecord[], memberId: string): number {
  const recs = records.filter((r) => r.memberId === memberId).sort((a, b) => a.period - b.period);
  let score = 0;
  // A 'partial' period counts the same as 'missed' — only a fully 'paid'
  // period earns the decay (see functions/shared/mgr_engine.py::late_score).
  for (const r of recs) score = r.status === 'missed' || r.status === 'partial' ? score + 1 : score * LATE_DECAY;
  return Math.round(score * 100) / 100;
}

export function recentReliability(records: MgrRecord[], memberId: string, windowSize = 10): number {
  const recs = records
    .filter((r) => r.memberId === memberId)
    .sort((a, b) => a.period - b.period)
    .slice(-windowSize);
  if (!recs.length) return 100;
  return Math.round((100 * recs.filter((r) => r.status === 'paid').length) / recs.length);
}

export function missedCount(records: MgrRecord[], memberId: string): number {
  // Counts both full misses and partial payments — anything short of the
  // full amount still leaves a gap the member owes (mirrors
  // functions/shared/mgr_engine.py::missed_count).
  return records.filter((r) => r.memberId === memberId && (r.status === 'missed' || r.status === 'partial')).length;
}

export function poolEstimate(pot: Pick<MgrPot, 'amount' | 'memberIds' | 'periodsPerRound'>): number {
  return pot.amount * pot.memberIds.length * pot.periodsPerRound;
}

export function isShortRound(pot: Pick<MgrPot, 'queue' | 'recipientsPerRound'>): boolean {
  return pot.queue.length > 0 && pot.queue.length < pot.recipientsPerRound;
}

/**
 * DISPLAY-ONLY preview of what a "smart" reorder would look like — sorts
 * by late score with no random tie-break (the real draw/close always
 * shuffles first server-side; see functions/shared/mgr_engine.py). Lets
 * the queue-reorder UI show a "suggested order" button that fills the
 * editor instantly, without waiting on a round trip — the admin can still
 * drag it further before mgrReorderQueue commits anything. Never used to
 * decide an actual payout.
 */
export function previewSmartOrder(records: MgrRecord[], pool: string[]): string[] {
  return [...pool].sort((a, b) => lateScore(records, a) - lateScore(records, b));
}

export interface MgrHealthFinding {
  code: string;
  memberId?: string;
  message: string;
}

/**
 * Pure diagnostics — mirrors functions/shared/mgr_engine.py::health_check
 * field for field. Safe to run client-side for an instant Health card;
 * only mgrRepairPot (server-only) may act on what this finds.
 *
 * `payouts` defaults to [] for callers that don't have the payouts
 * subcollection loaded (e.g. the pot-list card, to avoid an extra
 * listener per card) — in that case a member paid out this cycle can be
 * mis-flagged as "missing" here, same as before this fix. The detail
 * page (the only place "Repair queue" actually runs) always passes the
 * real payouts, which is what matters: mgrRepairPot itself checks the
 * server's own copy of `payouts` regardless of what this preview saw.
 */
export function healthCheck(
  pot: Pick<MgrPot, 'memberIds' | 'queue' | 'status' | 'pendingShortfall' | 'recipientsPerRound' | 'cycleNumber'>,
  arrears: Pick<MgrArrear, 'memberId' | 'status'>[],
  payouts: Pick<MgrPayout, 'memberId' | 'cycleNumber'>[] = []
): MgrHealthFinding[] {
  const findings: MgrHealthFinding[] = [];
  const memberSet = new Set(pot.memberIds);
  const queueSet = new Set(pot.queue);

  const seen = new Set<string>();
  for (const m of pot.queue) {
    if (seen.has(m)) findings.push({ code: 'duplicate_in_queue', memberId: m, message: 'Appears more than once in the payout queue.' });
    seen.add(m);
  }

  for (const m of queueSet) {
    if (!memberSet.has(m)) findings.push({ code: 'orphaned_in_queue', memberId: m, message: 'In the payout queue but no longer a pot member.' });
  }

  // A member absent from the queue isn't necessarily "missing" — the
  // normal, correct outcome of a payout is removal from the queue. Only
  // flag members who are neither in the queue NOR already paid out THIS
  // cycle; cycleNumber-gated so someone paid in a PRIOR cycle, now
  // legitimately back for a fresh mgrStartNewCycle draw, still gets
  // flagged if they're genuinely absent from the new queue.
  const currentCycle = pot.cycleNumber ?? 1;
  const paidOutThisCycle = new Set(payouts.filter((p) => (p.cycleNumber ?? 1) === currentCycle).map((p) => p.memberId));
  if (pot.status === 'active') {
    for (const m of memberSet) {
      if (!queueSet.has(m) && !paidOutThisCycle.has(m)) {
        findings.push({ code: 'missing_from_queue', memberId: m, message: 'A pot member with no place in the payout queue.' });
      }
    }
  }

  for (const a of arrears) {
    if (a.status === 'open' && !memberSet.has(a.memberId)) {
      findings.push({ code: 'arrear_for_ex_member', memberId: a.memberId, message: 'Has an open arrear but is no longer a pot member — settle or write off before closing the pot.' });
    }
  }

  if ((pot.pendingShortfall ?? 0) > 0) {
    findings.push({ code: 'uncovered_shortfall', message: `KES ${(pot.pendingShortfall ?? 0).toLocaleString()} of the last completed round was never covered.` });
  }

  if (isShortRound(pot) && pot.status === 'active') {
    findings.push({ code: 'short_round', message: "Fewer members remain than a full round needs — the next payout will use a final settlement plan." });
  }

  return findings;
}
