import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers } from '../../app/useMembers';
import { createMgrPot } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes } from '../../lib/money';
import { healthCheck, poolEstimate } from '../../lib/mgrEngine';
import type { MgrPot } from '../../lib/types';
import MyMgr from './MyMgr';

export default function MgrPots() {
  const { chamaId, isFinanceAdmin, membership } = useChama();
  if (membership?.role === 'member') return <MyMgr />;
  return <AdminMgrPots chamaId={chamaId} isFinanceAdmin={isFinanceAdmin} />;
}

function AdminMgrPots({ chamaId, isFinanceAdmin }: { chamaId: string | null; isFinanceAdmin: boolean }) {
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
      <div className="mgr-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Merry-Go-Round</h1>
          <p className="text-sm text-white/70 mt-1">{pots.length} pot{pots.length === 1 ? '' : 's'} running</p>
        </div>
        {isFinanceAdmin && (
          <button onClick={() => setShowForm(true)} className="btn-add text-sm">
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
        {pots.map((p) => {
          // List-level health check: only findings derivable from the pot doc
          // itself (duplicate/orphaned/missing-from-queue, uncovered
          // shortfall, short round) — the one finding that needs the arrears
          // subcollection (arrear_for_ex_member) still only shows once you
          // open the pot, to avoid an extra listener per card.
          const findings = isFinanceAdmin ? healthCheck(p, []) : [];
          return (
            <div
              key={p.id}
              className="card p-5 cursor-pointer hover:border-forest-300 border-l-4"
              style={{ borderLeftColor: p.status === 'draft' ? 'var(--color-gold-400)' : p.status === 'completed' ? '#B8BDB6' : 'var(--color-forest-700)' }}
              onClick={() => navigate(`/app/mgr/${p.id}`)}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display font-semibold">{p.name}</h3>
                {findings.length > 0 && <span className="chip bg-gold-50 text-gold-700 text-xs shrink-0">Needs attention</span>}
              </div>
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
          );
        })}
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
  const [exitCutPercent, setExitCutPercent] = useState('0');
  const [finalRoundPolicy, setFinalRoundPolicy] = useState<'split' | 'carry_over' | 'close_early'>('split');
  const [sendReminders, setSendReminders] = useState(false);
  const [selected, setSelected] = useState<string[]>(memberIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const { members } = useMembers(chamaId, false);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Demo audit: "Live preview while creating a pot (pool size, # of payout
  // rounds, whether the last round will be short)" — this mirrors
  // mgrEngine.ts's poolEstimate/isShortRound math against the in-progress
  // form instead of a saved pot, since there's no pot doc yet to run those
  // against.
  const recipients = Math.max(1, Number(recipientsPerRound) || 1);
  const previewPool = Number(amount || 0) * selected.length * Math.max(1, Number(periodsPerRound) || 1);
  const previewRounds = selected.length ? Math.ceil(selected.length / recipients) : 0;
  const previewShort = selected.length > 0 && selected.length % recipients !== 0;

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
        exitCutPercent: Number(exitCutPercent) || 0,
        finalRoundPolicy,
      });
      if (sendReminders && res.potId) {
        // Same direct write src/features/mgr/MgrPotDetail.tsx's own
        // Reminders toggle uses — firestore.rules lets any official write
        // smsSchedules directly (see that file's match block).
        const scheduleRef = doc(collection(db, paths.smsSchedules(chamaId)));
        await setDoc(scheduleRef, {
          status: 'active',
          body: `Reminder: your ${name.trim() || 'Merry-go-round'} contribution of ${kes(Number(amount))} is due.`,
          audience: 'custom',
          memberIds: selected,
          frequency,
          nextRun: Date.now() + 60 * 1000,
          potId: res.potId,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, paths.mgrPot(chamaId, res.potId)), { remindersEnabled: true, reminderScheduleId: scheduleRef.id });
      }
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
      <label className="flex flex-col gap-1 text-sm font-medium">
        Exit cut %
        <input type="number" min={0} max={100} value={exitCutPercent} onChange={(e) => setExitCutPercent(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
        <span className="text-xs text-forest-900/50 font-normal">Withheld from a departing member's refund if they exit mid-cycle. 0 = none.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        If the last round doesn't fill
        <select value={finalRoundPolicy} onChange={(e) => setFinalRoundPolicy(e.target.value as typeof finalRoundPolicy)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
          <option value="split">Split what's collected evenly — fewer members just share a smaller pool</option>
          <option value="carry_over">Pay everyone their full share, then start a new cycle automatically</option>
          <option value="close_early">Pay everyone their full share, then rest once this cycle is done</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={sendReminders} onChange={(e) => setSendReminders(e.target.checked)} disabled={busy} />
        Send reminders automatically
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

      {selected.length > 0 && (
        <p className="text-xs bg-forest-50 text-forest-900/70 rounded-lg px-3 py-2">
          Pool ~{kes(previewPool)} · {previewRounds} payout round{previewRounds === 1 ? '' : 's'}
          {previewShort && ' · the last round will be short — see the policy above'}
        </p>
      )}

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
