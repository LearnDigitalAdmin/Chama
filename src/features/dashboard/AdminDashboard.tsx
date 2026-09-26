/**
 * Admin/official Home — Phase 4.
 *
 * KPI design note (see TOUCH_BASE.md "Dashboard aggregation"): every number
 * here comes from a small-scope `onSnapshot` listener (current period's
 * contributions, active/pending loans, mgr pots, a handful of recent
 * transactions/messages/minutes) rather than maintained counters or
 * `getCountFromServer` aggregation queries. That's a deliberate choice:
 * it matches every other screen in this codebase, and it's what gives a
 * chair mid-meeting the same "updates while you watch" feel as the rest of
 * the app. At chama scale (dozens to a few hundred docs per collection,
 * not thousands) the read cost of this is trivial. If a chama's history
 * grows very large, the per-KPI counts (not the feed, which should stay a
 * listener) are the first candidates to switch to `getCountFromServer`.
 *
 * Dashboard audit fixes: the goal ring, "needs your attention" feed, group
 * balance figure, and dynamic MGR banner below were all 🔴 in the feature
 * audit ("just numbers", "4 generic static links", nothing). The open-
 * arrears count for the MGR banner is the one figure here that isn't on the
 * pot doc itself, so it fans out one small onSnapshot per active/completed
 * pot's arrears subcollection — same "trivial at chama scale" reasoning as
 * everything else on this page.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, orderBy, query, where, limit as fbLimit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers, memberName } from '../../app/useMembers';
import { kes } from '../../lib/money';
import { periodKeyOf, fmtDate } from '../../lib/dates';
import { PLANS } from '../../lib/constants';
import type { Contribution, Loan, MgrPot, ChamaTransaction, SmsLogEntry, Minute } from '../../lib/types';

const TX_LABEL: Record<string, string> = {
  contribution: 'Contribution',
  loan_disbursement: 'Loan disbursed',
  loan_repayment: 'Loan repayment',
  mgr_contribution: 'MGR contribution',
  mgr_payout: 'MGR payout',
};

/** Hand-rolled SVG progress ring — no charting library needed for one number. */
function GoalRing({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="8" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke="var(--color-gold-400)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (clamped / 100) * c}
          transform="rotate(-90 36 36)"
        />
        <text x="36" y="41" textAnchor="middle" fontSize="18" fontWeight="700" fill="#fff">
          {Math.round(clamped)}%
        </text>
      </svg>
      <p className="text-sm text-white/80">{label}</p>
    </div>
  );
}

const BANNER_TONE: Record<string, string> = {
  brick: 'bg-brick-50 border-brick-300 ring-brick-200 text-brick-500',
  gold: 'bg-gold-50 border-gold-300 ring-gold-200 text-gold-700',
  forest: 'bg-forest-50 border-forest-300 ring-forest-200 text-forest-700',
};

export default function AdminDashboard() {
  const { chama, chamaId, chamaReady, isFinanceAdmin } = useChama();
  const { members } = useMembers(chamaId, true);

  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [pots, setPots] = useState<MgrPot[]>([]);
  const [txns, setTxns] = useState<ChamaTransaction[]>([]);
  const [allTxns, setAllTxns] = useState<ChamaTransaction[]>([]);
  const [messages, setMessages] = useState<SmsLogEntry[]>([]);
  const [minutes, setMinutes] = useState<Minute[]>([]);
  const [openArrearsCount, setOpenArrearsCount] = useState(0);

  const currentPeriod = periodKeyOf();

  useEffect(() => {
    if (!chamaId) return;
    const unsubs = [
      onSnapshot(query(collection(db, paths.contributions(chamaId)), where('periodKey', '==', currentPeriod)), (s) =>
        setContributions(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Contribution))
      ),
      onSnapshot(collection(db, paths.loans(chamaId)), (s) => setLoans(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Loan))),
      onSnapshot(collection(db, paths.mgrPots(chamaId)), (s) => setPots(s.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrPot))),
      onSnapshot(query(collection(db, paths.transactions(chamaId)), orderBy('createdAt', 'desc'), fbLimit(10)), (s) =>
        setTxns(s.docs.map((d) => ({ id: d.id, ...d.data() }) as ChamaTransaction))
      ),
      // Group balance needs every transaction, not just the recent-10 feed
      // slice above — trivial at chama scale (see file header note).
      onSnapshot(collection(db, paths.transactions(chamaId)), (s) => setAllTxns(s.docs.map((d) => ({ id: d.id, ...d.data() }) as ChamaTransaction))),
      onSnapshot(query(collection(db, paths.smsLog(chamaId)), orderBy('createdAt', 'desc'), fbLimit(5)), (s) =>
        setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }) as SmsLogEntry))
      ),
      onSnapshot(query(collection(db, paths.minutes(chamaId)), orderBy('date', 'desc'), fbLimit(3)), (s) =>
        setMinutes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Minute))
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [chamaId, currentPeriod]);

  // One small arrears listener per active/completed pot — see file header.
  useEffect(() => {
    if (!chamaId) return;
    const relevant = pots.filter((p) => p.status === 'active' || p.status === 'completed');
    if (relevant.length === 0) {
      setOpenArrearsCount(0);
      return;
    }
    const counts: Record<string, number> = {};
    const unsubs = relevant.map((p) =>
      onSnapshot(query(collection(db, paths.mgrArrears(chamaId, p.id)), where('status', '==', 'open')), (s) => {
        counts[p.id] = s.size;
        setOpenArrearsCount(Object.values(counts).reduce((a, b) => a + b, 0));
      })
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chamaId, pots.map((p) => `${p.id}:${p.status}`).join(',')]);

  const feed = useMemo(() => {
    const items = [
      ...txns.map((t) => ({
        key: 'tx-' + t.id,
        at: t.createdAt ?? new Date(t.date).getTime(),
        text: `${TX_LABEL[t.type] ?? t.type} — ${memberName(members, t.memberId)} · ${kes(t.amount)}`,
      })),
      ...messages.map((m) => ({
        key: 'sms-' + m.id,
        at: m.createdAt,
        text: `SMS sent to ${m.sentCount} member${m.sentCount === 1 ? '' : 's'} (${m.audience})`,
      })),
      ...minutes.map((m) => ({ key: 'min-' + m.id, at: m.createdAt ?? new Date(m.date).getTime(), text: `Minutes recorded — ${m.title}` })),
    ];
    return items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 8);
  }, [txns, messages, minutes, members]);

  if (!chamaReady || !chama) return <p className="text-forest-900/60">Loading…</p>;

  const paidThisPeriod = contributions.filter((c) => c.status === 'paid').length;
  const collectedThisPeriod = contributions.reduce((s, c) => s + (c.paidAmount || 0), 0);
  const expectedThisPeriod = chama.contributionAmount * members.length;
  const activeLoans = loans.filter((l) => l.status === 'active' || l.status === 'overdue');
  const overdueLoans = loans.filter((l) => l.status === 'overdue');
  const pendingLoans = loans.filter((l) => l.status === 'pending_approval' || l.status === 'awaiting_treasurer');
  const overdueContributions = contributions.filter((c) => c.status === 'overdue');
  const activePots = pots.filter((p) => p.status === 'active');
  const draftPots = pots.filter((p) => p.status === 'draft');
  const plan = PLANS[chama.plan];
  // Seeded from the chama's opening balance (what it had banked before
  // joining the app — set at creation, correctable only by the treasurer in
  // Settings) plus everything the ledger has recorded since.
  const groupBalance =
    (chama.openingBalance ?? 0) + allTxns.reduce((s, t) => s + (t.direction === 'in' ? t.amount : -t.amount), 0);
  const goalPercent = members.length ? (paidThisPeriod / members.length) * 100 : 0;

  const attentionItems: { key: string; text: string; to: string }[] = [
    ...pendingLoans.map((l) => ({ key: 'pl-' + l.id, text: `Loan approval needed — ${memberName(members, l.memberId)} · ${kes(l.principal)}`, to: '/app/loans' })),
    ...overdueLoans.map((l) => ({ key: 'ol-' + l.id, text: `Overdue loan — ${memberName(members, l.memberId)}`, to: '/app/loans' })),
    ...overdueContributions.map((c) => ({ key: 'oc-' + c.id, text: `Overdue contribution — ${memberName(members, c.memberId)}`, to: '/app/contributions' })),
  ].slice(0, 8);

  const shortfallTotal = pots.reduce((s, p) => s + (p.pendingShortfall || 0), 0);
  const shortfallPot = pots.find((p) => (p.pendingShortfall || 0) > 0);
  const completedPot = pots.find((p) => p.status === 'completed');
  const soleActivePot = pots.find((p) => p.status === 'active');

  const mgrBanner =
    shortfallTotal > 0
      ? { tone: 'brick', text: `${kes(shortfallTotal)} MGR shortfall needs covering${shortfallPot ? ` in ${shortfallPot.name}` : ''}.`, to: shortfallPot ? `/app/mgr/${shortfallPot.id}` : '/app/mgr' }
      : completedPot
        ? { tone: 'gold', text: `Cycle complete in ${completedPot.name} — start a new one, or close it.`, to: `/app/mgr/${completedPot.id}` }
        : openArrearsCount > 0
          ? { tone: 'gold', text: `${openArrearsCount} MGR arrear${openArrearsCount === 1 ? '' : 's'} to recover.`, to: '/app/mgr' }
          : soleActivePot
            ? { tone: 'forest', text: `${soleActivePot.name} is mid-cycle — period ${soleActivePot.period} of the current round.`, to: `/app/mgr/${soleActivePot.id}` }
            : null;

  return (
    <div className="space-y-5">
      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">{chama.name}</h1>
          {chama.motto && <p className="text-sm text-white/70 mt-0.5">{chama.motto}</p>}
        </div>
        <GoalRing percent={goalPercent} label={`${paidThisPeriod} of ${members.length} paid this period`} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="card p-5">
          <p className="text-xs font-semibold text-forest-900/50">Members</p>
          <p className="font-display text-2xl font-semibold mt-1">{members.length}</p>
          <p className="text-xs text-forest-900/45 mt-1">of {plan.memberLimit === 999 ? 'unlimited' : plan.memberLimit} on {plan.name}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold text-forest-900/50">This period's contributions</p>
          <p className="font-display text-2xl font-semibold mt-1">{kes(collectedThisPeriod)}</p>
          <p className="text-xs text-forest-900/45 mt-1">
            {paidThisPeriod} of {members.length} paid · target {kes(expectedThisPeriod)}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold text-forest-900/50">Group balance</p>
          <p className="font-display text-2xl font-semibold mt-1">{kes(groupBalance)}</p>
          <p className="text-xs text-forest-900/45 mt-1">Net across every recorded transaction</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold text-forest-900/50">Loans</p>
          <p className="font-display text-2xl font-semibold mt-1">{activeLoans.length} active</p>
          <p className="text-xs mt-1 flex gap-2">
            {overdueLoans.length > 0 && <span className="text-brick-500 font-semibold">{overdueLoans.length} overdue</span>}
            {pendingLoans.length > 0 && <span className="text-gold-700 font-semibold">{pendingLoans.length} pending approval</span>}
            {!overdueLoans.length && !pendingLoans.length && <span className="text-forest-900/45">All clear</span>}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold text-forest-900/50">Merry-go-round</p>
          <p className="font-display text-2xl font-semibold mt-1">{activePots.length} active</p>
          <p className="text-xs text-forest-900/45 mt-1">{draftPots.length ? `${draftPots.length} awaiting a draw` : 'No pots awaiting a draw'}</p>
        </div>
      </div>

      {isFinanceAdmin && (chama.smsCredits ?? 0) < 50 && (
        <div className="card p-4 border-gold-300 ring-1 ring-gold-200 flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-ink">
            SMS credits are low (<b>{Math.round(chama.smsCredits ?? 0)}</b> left).
          </p>
          <Link to="/app/communication" className="text-sm font-semibold text-forest-700">
            Top up →
          </Link>
        </div>
      )}

      {mgrBanner && (
        <Link to={mgrBanner.to} className={`card p-4 border ring-1 flex items-center justify-between gap-2 ${BANNER_TONE[mgrBanner.tone]}`}>
          <p className="text-sm font-semibold">{mgrBanner.text}</p>
          <span className="text-sm font-semibold whitespace-nowrap">View →</span>
        </Link>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <h3 className="font-display font-semibold mb-3">Needs your attention</h3>
          {attentionItems.length ? (
            <ul className="divide-y divide-forest-50">
              {attentionItems.map((a) => (
                <li key={a.key} className="py-2.5">
                  <Link to={a.to} className="text-sm flex items-center justify-between gap-3 hover:text-forest-700">
                    <span>{a.text}</span>
                    <span className="text-xs font-semibold whitespace-nowrap">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-forest-900/50">Nothing pending — you're all caught up.</p>
          )}
        </div>

        <div className="lg:col-span-2 card p-5">
          <h3 className="font-display font-semibold mb-3">Recent activity</h3>
          {feed.length ? (
            <ul className="divide-y divide-forest-50">
              {feed.map((f) => (
                <li key={f.key} className="py-2.5 text-sm flex items-center justify-between gap-3">
                  <span>{f.text}</span>
                  <span className="text-xs text-forest-900/40 whitespace-nowrap">{f.at ? fmtDate(new Date(f.at).toISOString().slice(0, 10)) : ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-forest-900/50">Nothing recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
