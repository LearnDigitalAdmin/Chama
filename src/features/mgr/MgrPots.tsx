import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers } from '../../app/useMembers';
import { createMgrPot } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes } from '../../lib/money';
import { poolEstimate } from '../../lib/mgrEngine';
import type { MgrPot } from '../../lib/types';

export default function MgrPots() {
  const { chamaId, isFinanceAdmin } = useChama();
  const [pots, setPots] = useState<MgrPot[]>([]);
  const [showForm, setShowForm] = useState(false);
  const { members } = useMembers(chamaId);
  const navigate = useNavigate();

  useEffect(() => {
    if (!chamaId) return;
    return onSnapshot(collection(db, paths.mgrPots(chamaId)), (snap) => {
      setPots(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrPot));
    });
  }, [chamaId]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">Merry-Go-Round</h1>
        {isFinanceAdmin && (
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full">
            + New pot
          </button>
        )}
      </div>

      {showForm && chamaId && (
        <CreatePotForm
          chamaId={chamaId}
          memberIds={members.map((m) => m.id)}
          onDone={(id) => {
            setShowForm(false);
            if (id) navigate(`/app/mgr/${id}`);
          }}
        />
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {pots.map((p) => (
          <div key={p.id} className="card p-5 cursor-pointer hover:border-forest-300" onClick={() => navigate(`/app/mgr/${p.id}`)}>
            <h3 className="font-display font-semibold">{p.name}</h3>
            <p className="text-sm text-forest-900/60 mt-1">
              {kes(p.amount)} · {p.frequency} · {p.memberIds.length} members
            </p>
            <p className="text-sm text-forest-900/60">
              {p.status === 'draft' ? (
                <span className="chip bg-gold-50 text-gold-700">Needs a draw</span>
              ) : p.status === 'completed' ? (
                <span className="chip bg-forest-50 text-forest-900/50">Cycle complete</span>
              ) : (
                `Pool ~${kes(poolEstimate(p))}`
              )}
            </p>
          </div>
        ))}
        {!pots.length && <p className="text-forest-900/50">No merry-go-rounds yet.</p>}
      </div>
    </div>
  );
}

function CreatePotForm({ chamaId, memberIds, onDone }: { chamaId: string; memberIds: string[]; onDone: (id: string) => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('300');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [periodsPerRound, setPeriodsPerRound] = useState('1');
  const [recipientsPerRound, setRecipientsPerRound] = useState('1');
  const [selected, setSelected] = useState<string[]>(memberIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const { members } = useMembers(chamaId, false);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setError(null);
    if (selected.length < 2) {
      setError('Pick at least 2 members.');
      return;
    }
    setBusy(true);
    try {
      const res = await createMgrPot({
        chamaId,
        name: name.trim() || 'Merry-go-round',
        amount: Number(amount),
        frequency,
        periodsPerRound: Number(periodsPerRound),
        recipientsPerRound: Number(recipientsPerRound),
        memberIds: selected,
      });
      onDone(res.potId);
    } catch (e) {
      const { message, isQueued } = describeCallError(e);
      if (isQueued) {
        setQueuedMsg(message);
        setTimeout(() => onDone(''), 1200);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 max-w-md flex flex-col gap-3">
      <h3 className="font-display font-semibold">New merry-go-round</h3>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Amount per member (KES)
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Frequency
        <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Periods before payout
        <input type="number" min={1} value={periodsPerRound} onChange={(e) => setPeriodsPerRound(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Recipients per payout
        <input type="number" min={1} value={recipientsPerRound} onChange={(e) => setRecipientsPerRound(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <fieldset className="border border-forest-100 rounded-lg p-3">
        <legend className="text-xs font-semibold px-1">Members ({selected.length} selected)</legend>
        <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
          {memberIds.map((id) => (
            <label key={id} className="flex items-center gap-2 text-sm py-0.5">
              <input type="checkbox" checked={selected.includes(id)} onChange={() => toggle(id)} disabled={busy} />
              {members.find((m) => m.id === id)?.name ?? id}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button onClick={() => onDone('')} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
      {queuedMsg && <p className="text-sm text-gold-700 font-medium">{queuedMsg}</p>}
    </div>
  );
}
