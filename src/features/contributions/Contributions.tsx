import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers, memberName } from '../../app/useMembers';
import { recordCashContribution } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes } from '../../lib/money';
import type { Contribution } from '../../lib/types';

const STATUS_CHIP: Record<string, string> = {
  paid: 'bg-forest-50 text-forest-700',
  partial: 'bg-gold-50 text-gold-700',
  pending: 'bg-forest-50 text-forest-900/50',
  overdue: 'bg-brick-50 text-brick-500',
};

export default function Contributions() {
  const { chamaId, isFinanceAdmin } = useChama();
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const { members } = useMembers(chamaId, false);
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!chamaId) return;
    return onSnapshot(collection(db, paths.contributions(chamaId)), (snap) => {
      setContributions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contribution));
    });
  }, [chamaId]);

  const periods = useMemo(() => [...new Set(contributions.map((c) => c.periodKey))].sort().reverse(), [contributions]);
  const activePeriod = periodKey ?? periods[0] ?? null;
  const rows = contributions.filter((c) => c.periodKey === activePeriod);

  const totals = rows.reduce(
    (acc, r) => {
      acc.expected += r.amount;
      acc.collected += r.paidAmount;
      return acc;
    },
    { expected: 0, collected: 0 }
  );

  async function record(c: Contribution) {
    if (!chamaId) return;
    const amount = Number(amounts[c.id] ?? c.amount - c.paidAmount);
    if (!(amount > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setError(null);
    setBusyId(c.id);
    try {
      await recordCashContribution({ chamaId, memberId: c.memberId, contributionId: c.id, amount });
      setAmounts((prev) => ({ ...prev, [c.id]: '' }));
    } catch (e) {
      const { message, isQueued } = describeCallError(e);
      isQueued ? setQueuedMsg(message) : setError(message);
    } finally {
      setBusyId(null);
    }
  }

  if (!periods.length) {
    return <p className="text-forest-900/60">No contribution cycles yet — the first one opens automatically on your chama's next cycle date.</p>;
  }

  const pct = totals.expected ? Math.round((totals.collected / totals.expected) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">Contributions</h1>
        <select value={activePeriod ?? ''} onChange={(e) => setPeriodKey(e.target.value)} className="px-3 py-2 rounded-lg border border-forest-100 text-sm">
          {periods.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="card p-4">
        <p className="text-sm text-forest-900/70">
          {kes(totals.collected)} of {kes(totals.expected)} collected
        </p>
        <div className="h-2 rounded-full bg-forest-50 overflow-hidden mt-2">
          <div className="h-full bg-gold-400" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
      {queuedMsg && <p className="text-sm text-gold-700 font-medium">{queuedMsg}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-forest-900/50 text-xs border-b border-forest-100">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {isFinanceAdmin && <th className="px-4 py-3 font-medium">Record cash</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-forest-50 last:border-0">
                <td className="px-4 py-3 font-medium">{memberName(members, c.memberId)}</td>
                <td className="px-4 py-3 num">{c.status === 'partial' ? `${kes(c.paidAmount)} of ${kes(c.amount)}` : kes(c.amount)}</td>
                <td className="px-4 py-3">
                  <span className={`chip ${STATUS_CHIP[c.status]}`}>{c.status}</span>
                </td>
                {isFinanceAdmin && (
                  <td className="px-4 py-3">
                    {c.status !== 'paid' && (
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder={String(c.amount - c.paidAmount)}
                          value={amounts[c.id] ?? ''}
                          onChange={(e) => setAmounts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          className="w-24 px-2 py-1.5 rounded-lg border border-forest-100 text-sm"
                          disabled={busyId === c.id}
                        />
                        <button
                          onClick={() => record(c)}
                          disabled={busyId === c.id}
                          className="btn-primary text-xs font-semibold px-3 py-1.5 rounded-full"
                        >
                          {busyId === c.id ? '…' : 'Record'}
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
