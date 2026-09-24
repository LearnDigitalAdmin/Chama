/**
 * NEW IN PHASE 2 — read-only mirror of functions/shared/mgr_engine.py, for
 * rendering figures like "% on-time" in the UI. The WRITE path (drawing,
 * closing a period) only ever runs server-side, in the callables in
 * functions/mychama/mgr.py — nothing here mutates a queue or a record.
 */

import type { MgrArrear, MgrPot, MgrRecord } from './types';

const LATE_DECAY = 0.7;

export function lateScore(records: MgrRecord[], memberId: string): number {
  const recs = records.filter((r) => r.memberId === memberId).sort((a, b) => a.period - b.period);
  let score = 0;
  for (const r of recs) score = r.status === 'missed' ? score + 1 : score * LATE_DECAY;
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
  return records.filter((r) => r.memberId === memberId && r.status === 'missed').length;
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
 */
export function healthCheck(
  pot: Pick<MgrPot, 'memberIds' | 'queue' | 'status' | 'pendingShortfall' | 'recipientsPerRound'>,
  arrears: Pick<MgrArrear, 'memberId' | 'status'>[]
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

  if (pot.status === 'active') {
    for (const m of memberSet) {
      if (!queueSet.has(m)) findings.push({ code: 'missing_from_queue', memberId: m, message: 'A pot member with no place in the payout queue.' });
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
