import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { initiatePayment } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes } from '../../lib/money';
import { contributionFees } from '../../lib/money';
import { PLANS } from '../../lib/constants';
import type { Contribution } from '../../lib/types';

const STATUS_LABEL: Record<string, string> = { paid: 'Paid', partial: 'Partial', pending: 'Due', overdue: 'Overdue' };
const STATUS_CLASS: Record<string, string> = {
  paid: 'bg-forest-50 text-forest-700',
  partial: 'bg-gold-50 text-gold-700',
  pending: 'bg-forest-50 text-forest-900/50',
  overdue: 'bg-brick-50 text-brick-500',
};

export default function MyContributions() {
  const { chama, chamaId, chamaReady, membership } = useChama();
  const [rows, setRows] = useState<Contribution[]>([]);
  const [payTarget, setPayTarget] = useState<Contribution | null>(null);
  const memberId = membership?.memberId;

  useEffect(() => {
    if (!chamaId || !memberId) return;
    const unsub = onSnapshot(
      query(collection(db, paths.contributions(chamaId)), where('memberId', '==', memberId), orderBy('periodKey', 'desc')),
      (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Contribution))
    );
    return unsub;
  }, [chamaId, memberId]);

  if (!chamaReady || !chama) return <p className="text-forest-900/60">Loading…</p>;

  const onlineCollection = PLANS[chama.plan].onlineCollection;
  const outstanding = rows.filter((r) => r.status !== 'paid');
  const lifetimeTotal = rows.reduce((s, r) => s + r.paidAmount, 0);

  return (
    <div className="space-y-5">
      <div className="card p-6 bg-forest-700 border-forest-700 text-white">
        <p className="text-forest-100/70 text-sm">Total paid to date</p>
        <p className="font-display text-3xl font-semibold mt-1">{kes(lifetimeTotal)}</p>
        {outstanding.length > 0 && (
          <p className="text-gold-300 text-xs mt-3">
            {outstanding.length} cycle{outstanding.length === 1 ? '' : 's'} still outstanding.
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-forest-900/45 border-b border-forest-100">
                <th className="px-4 py-3 font-semibold">Period</th>
                <th className="px-4 py-3 font-semibold">Due</th>
                <th className="px-4 py-3 font-semibold">Paid</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-forest-50 last:border-0">
                    <td className="px-4 py-3 font-medium">{r.period}</td>
                    <td className="px-4 py-3 num">{kes(r.amount)}</td>
                    <td className="px-4 py-3 num">{kes(r.paidAmount)}</td>
                    <td className="px-4 py-3">
                      <span className={`chip ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className="px-4 py-3">
                      {r.status !== 'paid' && onlineCollection && (
                        <button onClick={() => setPayTarget(r)} className="text-xs font-semibold text-forest-700 hover:underline">
                          Pay now
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-forest-900/50">
                    No contribution cycles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!onlineCollection && outstanding.length > 0 && (
        <p className="text-xs text-forest-900/50">
          This chama is on the {PLANS[chama.plan].name} plan, which doesn't include online collection yet — pay your treasurer in cash.
        </p>
      )}

      {payTarget && chamaId && (
        <PayForm chamaId={chamaId} contribution={payTarget} onClose={() => setPayTarget(null)} />
      )}
    </div>
  );
}

function PayForm({ chamaId, contribution, onClose }: { chamaId: string; contribution: Contribution; onClose: () => void }) {
  const outstandingAmount = Math.max(0, contribution.amount - contribution.paidAmount);
  const [amount, setAmount] = useState(String(outstandingAmount));
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const net = Number(amount) || 0;
  const fees = net > 0 ? contributionFees(net) : null;

  async function submit() {
    setError(null);
    if (!(net > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      await initiatePayment({ chamaId, purpose: 'contribution', amount: net, phone, contributionId: contribution.id });
      setStarted(true);
    } catch (e) {
      setError(describeCallError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="card p-5 max-w-sm w-full flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-semibold">Pay for {contribution.period}</h3>
        {started ? (
          <>
            <p className="text-sm text-forest-700">Check your phone for the M-Pesa/Airtel Money prompt to complete the payment.</p>
            <button onClick={onClose} className="text-sm font-semibold text-forest-700 self-start">
              Done
            </button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Amount (KES)
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              M-Pesa/Airtel number
              <input type="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
            </label>
            {fees && (
              <p className="text-xs text-forest-900/50">
                Chama receives {kes(fees.net)} · you'll be charged {kes(fees.gross)} (covers the {kes(fees.paystackFee + fees.ourFee)} transaction fee).
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
                {busy ? 'Starting…' : 'Pay'}
              </button>
              <button onClick={onClose} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
                Cancel
              </button>
            </div>
            {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
