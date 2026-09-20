/**
 * NEW IN PHASE 2 — read-only mirror of functions/shared/mgr_engine.py, for
 * rendering figures like "% on-time" in the UI. The WRITE path (drawing,
 * closing a period) only ever runs server-side, in the callables in
 * functions/mychama/mgr.py — nothing here mutates a queue or a record.
 */

import type { MgrPot, MgrRecord } from './types';

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
