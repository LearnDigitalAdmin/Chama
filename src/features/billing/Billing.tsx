import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { upgradePlan } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes } from '../../lib/money';
import { fmtDate } from '../../lib/dates';
import { PLANS, PLAN_COPY, PLAN_ORDER } from '../../lib/constants';
import type { ChamaPlan, PlanBillingRecord } from '../../lib/types';

export default function Billing() {
  const { chama, chamaId, chamaReady, membership } = useChama();
  const [history, setHistory] = useState<PlanBillingRecord[]>([]);
  const [target, setTarget] = useState<ChamaPlan | null>(null);
  const canManage = membership?.role === 'chair';

  useEffect(() => {
    if (!chamaId || !canManage) return;
    return onSnapshot(query(collection(db, paths.planBilling(chamaId)), orderBy('createdAt', 'desc')), (s) =>
      setHistory(s.docs.map((d) => ({ id: d.id, ...d.data() }) as PlanBillingRecord))
    );
  }, [chamaId, canManage]);

  if (!chamaReady || !chama || !chamaId) return <p className="text-forest-900/60">Loading…</p>;

  async function toggleAutoRenew() {
    await updateDoc(doc(db, paths.chama(chamaId!)), { autoRenew: !chama!.autoRenew, updatedAt: Date.now() });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Plan & billing</h1>
        <p className="text-sm text-forest-900/50 mt-0.5">
          You're on <b>{PLANS[chama.plan].name}</b>
          {chama.plan !== 'free' && chama.planExpiry && <> · renews {fmtDate(chama.planExpiry)}</>}.
        </p>
      </div>

      {chama.plan !== 'free' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!chama.autoRenew} onChange={toggleAutoRenew} disabled={!canManage} />
          Remind me to renew before this plan expires
        </label>
      )}
      <p className="text-xs text-forest-900/45 -mt-3">
        MyChama can't charge M-Pesa/Airtel automatically — this only turns on a reminder SMS a few days before renewal. If the plan lapses unrenewed, the chama moves to Free automatically.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {PLAN_ORDER.map((key) => {
          const plan = PLANS[key];
          const copy = PLAN_COPY[key];
          const isCurrent = key === chama.plan;
          return (
            <div key={key} className={`card p-5 flex flex-col ${isCurrent ? 'ring-2 ring-forest-700' : ''}`}>
              <p className="font-display font-semibold">{plan.name}</p>
              <p className="font-display text-xl font-semibold mt-1">{plan.price === 0 ? 'Free' : kes(plan.price)}</p>
              {plan.price > 0 && <p className="text-xs text-forest-900/45">/ month</p>}
              <p className="text-xs text-forest-900/50 mt-2">{copy.blurb}</p>
              <ul className="text-xs text-forest-900/60 mt-3 space-y-1 flex-1">
                {copy.features.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <span className="chip bg-forest-50 text-forest-700 mt-3 text-center">Current plan</span>
              ) : canManage ? (
                <button onClick={() => setTarget(key)} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full mt-3">
                  {PLANS[key].price > PLANS[chama.plan].price ? 'Upgrade' : 'Switch'}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {!canManage && <p className="text-xs text-forest-900/45">Only the chair can change the chama's plan.</p>}

      {canManage && history.length > 0 && (
        <div className="card p-5">
          <h3 className="font-display font-semibold mb-3">Billing history</h3>
          <ul className="divide-y divide-forest-50">
            {history.map((h) => (
              <li key={h.id} className="py-2.5 text-sm flex items-center justify-between">
                <span>
                  {PLANS[h.fromPlan]?.name ?? h.fromPlan} → {PLANS[h.toPlan]?.name ?? h.toPlan}
                </span>
                <span className="flex items-center gap-2">
                  {kes(h.amountKes)}
                  <span className={`chip ${h.status === 'success' ? 'bg-forest-50 text-forest-700' : h.status === 'failed' ? 'bg-brick-50 text-brick-500' : 'bg-gold-50 text-gold-700'}`}>{h.status}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {target && chamaId && <UpgradeForm chamaId={chamaId} plan={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function UpgradeForm({ chamaId, plan, onClose }: { chamaId: string; plan: ChamaPlan; onClose: () => void }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const price = PLANS[plan].price;

  async function submit() {
    setError(null);
    if (price > 0 && !phone.trim()) {
      setError('Enter the phone number to pay from.');
      return;
    }
    setBusy(true);
    try {
      const res = await upgradePlan({ chamaId, plan, phone });
      if ('reference' in res) setStarted(true);
      else setDone(true);
    } catch (e) {
      setError(describeCallError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="card p-5 max-w-sm w-full flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-semibold">Switch to {PLANS[plan].name}</h3>
        {started ? (
          <p className="text-sm text-forest-700">Check your phone for the M-Pesa/Airtel Money prompt — the plan updates automatically once payment is confirmed.</p>
        ) : done ? (
          <p className="text-sm text-forest-700">Done — you're now on {PLANS[plan].name}.</p>
        ) : (
          <>
            {price > 0 ? (
              <>
                <p className="text-sm text-forest-900/60">{kes(price)}/month, charged to the phone below.</p>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Phone to pay from
                  <input type="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
                </label>
              </>
            ) : (
              <p className="text-sm text-forest-900/60">This takes effect immediately, no payment needed.</p>
            )}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
                {busy ? 'Working…' : price > 0 ? 'Pay & switch' : 'Confirm switch'}
              </button>
              <button onClick={onClose} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
                Cancel
              </button>
            </div>
            {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
          </>
        )}
        {(started || done) && (
          <button onClick={onClose} className="text-sm font-semibold text-forest-700 self-start">
            Close
          </button>
        )}
      </div>
    </div>
  );
}
