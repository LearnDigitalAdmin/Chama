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

export default function AdminDashboard() {
  const { chama, chamaId, chamaReady, isFinanceAdmin } = useChama();
  const { members } = useMembers(chamaId, true);

  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [pots, setPots] = useState<MgrPot[]>([]);
  const [txns, setTxns] = useState<ChamaTransaction[]>([]);
  const [messages, setMessages] = useState<SmsLogEntry[]>([]);
  const [minutes, setMinutes] = useState<Minute[]>([]);

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
      onSnapshot(query(collection(db, paths.smsLog(chamaId)), orderBy('createdAt', 'desc'), fbLimit(5)), (s) =>
        setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }) as SmsLogEntry))
      ),
      onSnapshot(query(collection(db, paths.minutes(chamaId)), orderBy('date', 'desc'), fbLimit(3)), (s) =>
        setMinutes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Minute))
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [chamaId, currentPeriod]);

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
  const activePots = pots.filter((p) => p.status === 'active');
  const draftPots = pots.filter((p) => p.status === 'draft');
  const plan = PLANS[chama.plan];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{chama.name}</h1>
        {chama.motto && <p className="text-sm text-forest-900/50 mt-0.5">{chama.motto}</p>}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      <div className="grid lg:grid-cols-3 gap-4">
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

        <div className="card p-5">
          <h3 className="font-display font-semibold mb-3">Quick links</h3>
          <div className="flex flex-col gap-2">
            <Link to="/app/contributions" className="text-sm font-semibold text-forest-700 hover:underline">
              Record a contribution →
            </Link>
            <Link to="/app/loans" className="text-sm font-semibold text-forest-700 hover:underline">
              Review loan applications →
            </Link>
            <Link to="/app/mgr" className="text-sm font-semibold text-forest-700 hover:underline">
              Manage merry-go-round →
            </Link>
            <Link to="/app/reports" className="text-sm font-semibold text-forest-700 hover:underline">
              Generate a statement →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
