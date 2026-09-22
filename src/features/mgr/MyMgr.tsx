import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { initiatePayment } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes, mgrContributionFees } from '../../lib/money';
import { recentReliability } from '../../lib/mgrEngine';
import { PLANS } from '../../lib/constants';
import type { MgrPot, MgrRecord, MgrPayout } from '../../lib/types';

export default function MyMgr() {
  const { chama, chamaId, chamaReady, membership } = useChama();
  const [pots, setPots] = useState<MgrPot[]>([]);
  const [activePotId, setActivePotId] = useState<string | null>(null);
  const memberId = membership?.memberId;

  useEffect(() => {
    if (!chamaId || !memberId) return;
    return onSnapshot(query(collection(db, paths.mgrPots(chamaId)), where('memberIds', 'array-contains', memberId)), (s) => {
      const all = s.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrPot);
      setPots(all);
      setActivePotId((prev) => (prev && all.some((p) => p.id === prev) ? prev : (all.find((p) => p.status === 'active') ?? all[0])?.id ?? null));
    });
  }, [chamaId, memberId]);

  if (!chamaReady || !chama || !memberId) return <p className="text-forest-900/60">Loading…</p>;

  if (!pots.length) {
    return (
      <div className="card p-6 text-center">
        <p className="font-display text-lg font-semibold">Not in a merry-go-round yet</p>
        <p className="text-sm text-forest-900/50 mt-1">Ask a finance admin to add you to one.</p>
      </div>
    );
  }

  const pot = pots.find((p) => p.id === activePotId) ?? pots[0];

  return (
    <div className="space-y-5">
      {pots.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pots.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePotId(p.id)}
              className={`chip whitespace-nowrap ${p.id === pot.id ? 'bg-forest-700 text-white' : 'bg-forest-50 text-forest-700'}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <PotCard chamaId={chamaId!} memberId={memberId} pot={pot} plan={chama.plan} />
    </div>
  );
}

function PotCard({ chamaId, memberId, pot, plan }: { chamaId: string; memberId: string; pot: MgrPot; plan: import('../../lib/types').ChamaPlan }) {
  const [records, setRecords] = useState<MgrRecord[]>([]);
  const [payouts, setPayouts] = useState<MgrPayout[]>([]);
  const [showPay, setShowPay] = useState(false);

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, paths.mgrRecords(chamaId, pot.id)), (s) => setRecords(s.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrRecord))),
      onSnapshot(collection(db, paths.mgrPayouts(chamaId, pot.id)), (s) => setPayouts(s.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrPayout))),
    ];
    return () => unsubs.forEach((u) => u());
  }, [chamaId, pot.id]);

  const pos = pot.queue.indexOf(memberId);
  const myRecordThisPeriod = records.find((r) => r.memberId === memberId && r.period === pot.period);
  const myPayouts = payouts.filter((p) => p.memberId === memberId);
  const totalReceived = myPayouts.reduce((s, p) => s + p.amount, 0);
  const reliability = Math.round(recentReliability(records, memberId) * 100);
  const onlineCollection = PLANS[plan].onlineCollection;

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <p className="text-xs font-semibold text-forest-900/50">{pot.name}</p>
        <p className="font-display text-2xl font-semibold mt-1">
          {kes(pot.amount)} <span className="text-sm font-normal text-forest-900/50">/ {pot.frequency}</span>
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {pot.status === 'draft' && <span className="chip bg-gold-50 text-gold-700">Waiting for the draw</span>}
          {pot.status === 'completed' && <span className="chip bg-forest-50 text-forest-900/50">Cycle complete</span>}
          {pot.status === 'active' && pos >= 0 && <span className="chip bg-forest-50 text-forest-700">You're #{pos + 1} in the queue</span>}
          <span className="chip bg-forest-50 text-forest-900/50">{reliability}% on-time</span>
        </div>
      </div>

      {pot.status === 'active' && (
        <div className="card p-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-semibold text-forest-900/50">This period</p>
            <p className="font-display text-lg font-semibold mt-1">
              {myRecordThisPeriod?.status === 'paid' ? (
                <span className="text-forest-700">Paid ✓</span>
              ) : (
                <>{kes(pot.amount)} due</>
              )}
            </p>
          </div>
          {myRecordThisPeriod?.status !== 'paid' && onlineCollection && (
            <button onClick={() => setShowPay(true)} className="btn-primary text-sm font-semibold px-4 py-2.5 rounded-full">
              Pay now
            </button>
          )}
        </div>
      )}

      {totalReceived > 0 && (
        <div className="card p-5">
          <p className="text-xs font-semibold text-forest-900/50">Received from this pot so far</p>
          <p className="font-display text-lg font-semibold mt-1">{kes(totalReceived)}</p>
        </div>
      )}

      {showPay && (
        <PayForm chamaId={chamaId} pot={pot} onClose={() => setShowPay(false)} />
      )}
    </div>
  );
}

function PayForm({ chamaId, pot, onClose }: { chamaId: string; pot: MgrPot; onClose: () => void }) {
  const [amount, setAmount] = useState(String(pot.amount));
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const net = Number(amount) || 0;
  const fees = net > 0 ? mgrContributionFees(net) : null;

  async function submit() {
    setError(null);
    if (!(net > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      await initiatePayment({ chamaId, purpose: 'mgr_contribution', amount: net, phone, potId: pot.id });
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
        <h3 className="font-display font-semibold">Pay into {pot.name}</h3>
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
                Pot receives {kes(fees.net)} · you'll be charged {kes(fees.gross)} (covers the {kes(fees.paystackFee + fees.ourFee)} transaction fee).
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
