import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, limit as fbLimit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers } from '../../app/useMembers';
import { sendSmsCampaign, purchaseSmsCredits } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { AUDIENCE_LABEL, PLANS, SMS_SEGMENT_LEN } from '../../lib/constants';
import { kes } from '../../lib/money';
import type { SmsLogEntry, SmsSchedule } from '../../lib/types';

type Audience = 'all' | 'overdue' | 'custom' | 'loan_holders' | 'admins';

export default function Communication() {
  const { chama, chamaId, chamaReady, isOfficial } = useChama();
  const { members } = useMembers(chamaId, false);
  const [tab, setTab] = useState<'compose' | 'scheduled'>('compose');
  const [audience, setAudience] = useState<Audience>('all');
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; creditsUsed: number } | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);

  // Mirrors functions/mychama/sms.py's _recipients() — used only to give the
  // live cost preview below a realistic recipient count for every audience,
  // not to decide who actually gets the message (the callable is still the
  // source of truth for that).
  const [overdueMemberIds, setOverdueMemberIds] = useState<Set<string>>(new Set());
  const [loanHolderMemberIds, setLoanHolderMemberIds] = useState<Set<string>>(new Set());
  const [smsLog, setSmsLog] = useState<SmsLogEntry[]>([]);

  useEffect(() => {
    if (!chamaId) return;
    const unsubOverdue = onSnapshot(query(collection(db, paths.contributions(chamaId))), (s) => {
      const ids = new Set<string>();
      s.docs.forEach((d) => {
        if (d.data().status === 'overdue') ids.add(d.data().memberId);
      });
      setOverdueMemberIds(ids);
    });
    const unsubLoans = onSnapshot(collection(db, paths.loans(chamaId)), (s) => {
      const ids = new Set<string>();
      s.docs.forEach((d) => {
        if (d.data().status === 'active' || d.data().status === 'overdue') ids.add(d.data().memberId);
      });
      setLoanHolderMemberIds(ids);
    });
    const unsubLog = onSnapshot(query(collection(db, paths.smsLog(chamaId)), orderBy('createdAt', 'desc'), fbLimit(20)), (s) =>
      setSmsLog(s.docs.map((d) => ({ id: d.id, ...d.data() }) as SmsLogEntry))
    );
    return () => {
      unsubOverdue();
      unsubLoans();
      unsubLog();
    };
  }, [chamaId]);

  const recipientEstimate = useMemo(() => {
    const active = members.filter((m) => m.status === 'active');
    if (audience === 'all') return active.length;
    if (audience === 'admins') return active.filter((m) => m.isAdmin).length;
    if (audience === 'overdue') return active.filter((m) => overdueMemberIds.has(m.id)).length;
    if (audience === 'loan_holders') return active.filter((m) => loanHolderMemberIds.has(m.id)).length;
    return customIds.length;
  }, [members, audience, overdueMemberIds, loanHolderMemberIds, customIds]);

  const segments = Math.max(1, Math.ceil(message.length / SMS_SEGMENT_LEN));
  const costEstimate = chama ? segments * recipientEstimate * PLANS[chama.plan].smsRate : 0;

  if (!chamaReady || !chama) return <p className="text-forest-900/60">Loading…</p>;

  function toggleCustom(id: string) {
    setCustomIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function send() {
    if (!chamaId) return;
    setError(null);
    setResult(null);
    if (!message.trim()) {
      setError('Write a message first.');
      return;
    }
    setBusy(true);
    try {
      const res = await sendSmsCampaign({
        chamaId,
        audience,
        memberIds: audience === 'custom' ? customIds : undefined,
        message: message.trim(),
      });
      setResult(res);
      setMessage('');
    } catch (e) {
      const { message: msg, isQueued } = describeCallError(e);
      isQueued ? setQueuedMsg(msg) : setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-semibold">Communication</h1>
        <div className="bg-white/10 rounded-xl px-4 py-2 flex items-center gap-3">
          <div>
            <p className="text-xs text-white/70">SMS credits</p>
            <p className="font-display font-semibold">{(chama.smsCredits ?? 0).toLocaleString()}</p>
          </div>
          <button onClick={() => setShowTopUp(true)} className="text-sm font-semibold text-white underline">
            Top up
          </button>
        </div>
      </div>

      {showTopUp && chamaId && <TopUpForm chamaId={chamaId} onDone={() => setShowTopUp(false)} />}

      <div className="flex gap-2 border-b border-forest-100">
        <button
          onClick={() => setTab('compose')}
          className={`text-sm font-semibold px-3 py-2 border-b-2 -mb-px ${tab === 'compose' ? 'border-forest-700 text-forest-900' : 'border-transparent text-forest-900/50'}`}
        >
          Compose
        </button>
        {isOfficial && (
          <button
            onClick={() => setTab('scheduled')}
            className={`text-sm font-semibold px-3 py-2 border-b-2 -mb-px ${tab === 'scheduled' ? 'border-forest-700 text-forest-900' : 'border-transparent text-forest-900/50'}`}
          >
            Scheduled &amp; recurring
          </button>
        )}
      </div>

      {tab === 'compose' && (
        <>
          <div className="card p-5 max-w-lg flex flex-col gap-3">
            <h3 className="font-display font-semibold">Send SMS</h3>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Audience
              <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
                <option value="all">All active members</option>
                <option value="overdue">Members with overdue contributions</option>
                <option value="loan_holders">Members with active loans</option>
                <option value="admins">Admins only</option>
                <option value="custom">Choose members</option>
              </select>
            </label>
            {audience === 'custom' && (
              <fieldset className="border border-forest-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm py-0.5">
                    <input type="checkbox" checked={customIds.includes(m.id)} onChange={() => toggleCustom(m.id)} disabled={busy} />
                    {m.name}
                  </label>
                ))}
              </fieldset>
            )}
            <label className="flex flex-col gap-1 text-sm font-medium">
              Message
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={400} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
            </label>
            <p className="text-xs text-forest-900/50">
              {message.length}/400 characters · {segments} segment{segments === 1 ? '' : 's'} × {recipientEstimate} recipient
              {recipientEstimate === 1 ? '' : 's'} ≈ {kes(costEstimate)}
            </p>
            <button onClick={send} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full self-start disabled:opacity-50">
              {busy ? 'Sending…' : 'Send SMS'}
            </button>
            {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
            {queuedMsg && <p className="text-sm text-gold-700 font-medium">{queuedMsg}</p>}
            {result && (
              <p className="text-sm text-forest-700 font-medium">
                Sent to {result.sent} member{result.sent === 1 ? '' : 's'} — {result.creditsUsed} credits used.
              </p>
            )}
          </div>

          <div className="card p-5 max-w-lg">
            <h3 className="font-display font-semibold mb-3">Message history</h3>
            {smsLog.length === 0 ? (
              <p className="text-sm text-forest-900/50">No campaigns sent yet.</p>
            ) : (
              <ul className="space-y-3">
                {smsLog.map((m) => (
                  <li key={m.id} className="border-b border-forest-50 last:border-0 pb-3 last:pb-0">
                    <p className="text-sm text-ink">{m.message}</p>
                    <div className="flex items-center justify-between mt-1 flex-wrap gap-1">
                      <span className="chip bg-forest-50 text-forest-900/50 text-xs">{AUDIENCE_LABEL[m.audience] ?? m.audience}</span>
                      <span className="text-xs text-forest-900/50">
                        {m.sentCount}/{m.recipientCount} delivered{m.sentCount < m.recipientCount ? ` · ${m.recipientCount - m.sentCount} failed` : ''}
                      </span>
                      <span className="text-xs text-forest-900/40">{new Date(m.createdAt).toLocaleString('en-KE')}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {tab === 'scheduled' && chamaId && isOfficial && <ScheduledTab chamaId={chamaId} members={members} />}
    </div>
  );
}

const FREQUENCY_LABEL: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

/**
 * Communication audit: "Scheduled & recurring messages — the entire tab" was
 * the single highest-value fix in the audit — functions/mychama/sms.py's
 * run_sms_schedules cron has been live in production reading
 * chamas/{chamaId}/smsSchedules the whole time, with no UI to create, edit,
 * pause, or delete one. firestore.rules already lets any official write
 * this collection directly (see the smsSchedules match block) — the same
 * pattern src/features/mgr/MgrPotDetail.tsx's per-pot reminder toggle
 * already uses — so this is a screen, not a new backend.
 */
function ScheduledTab({ chamaId, members }: { chamaId: string; members: { id: string; name: string }[] }) {
  const [schedules, setSchedules] = useState<SmsSchedule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db, paths.smsSchedules(chamaId)), orderBy('nextRun', 'asc')), (s) =>
      setSchedules(s.docs.map((d) => ({ id: d.id, ...d.data() }) as SmsSchedule))
    );
  }, [chamaId]);

  async function toggle(sched: SmsSchedule) {
    setError(null);
    try {
      await updateDoc(doc(db, paths.smsSchedules(chamaId), sched.id), { status: sched.status === 'active' ? 'paused' : 'active' });
    } catch {
      setError('Could not update that schedule — please try again.');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this schedule?')) return;
    setError(null);
    try {
      await deleteDoc(doc(db, paths.smsSchedules(chamaId), id));
    } catch {
      setError('Could not delete that schedule — please try again.');
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <button onClick={() => setShowForm(true)} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full self-start">
        + New schedule
      </button>

      {showForm && (
        <ScheduleForm
          chamaId={chamaId}
          members={members}
          onDone={() => setShowForm(false)}
          onError={setError}
        />
      )}

      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}

      {schedules.length === 0 ? (
        <p className="text-sm text-forest-900/50">No recurring or scheduled messages yet.</p>
      ) : (
        <ul className="space-y-3">
          {schedules.map((s) => (
            <li key={s.id} className="card p-4">
              <p className="text-sm text-ink">{s.body}</p>
              <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
                <span className="chip bg-forest-50 text-forest-900/50 text-xs">
                  {AUDIENCE_LABEL[s.audience] ?? s.audience} · {FREQUENCY_LABEL[s.frequency] ?? s.frequency}
                  {s.potId ? ' · linked to a merry-go-round pot' : ''}
                </span>
                <span className={`chip text-xs ${s.status === 'active' ? 'bg-forest-50 text-forest-700' : 'bg-forest-900/10 text-forest-900/50'}`}>{s.status}</span>
              </div>
              <div className="flex gap-3 mt-2">
                <button onClick={() => toggle(s)} className="text-xs font-semibold text-forest-700">
                  {s.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                <button onClick={() => remove(s.id)} className="text-xs font-semibold text-brick-500">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScheduleForm({
  chamaId,
  members,
  onDone,
  onError,
}: {
  chamaId: string;
  members: { id: string; name: string }[];
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('all');
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [busy, setBusy] = useState(false);

  function toggleCustom(id: string) {
    setCustomIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    onError(null);
    if (!body.trim()) {
      onError('Write a message first.');
      return;
    }
    setBusy(true);
    try {
      await setDoc(doc(collection(db, paths.smsSchedules(chamaId))), {
        status: 'active',
        body: body.trim(),
        audience,
        memberIds: audience === 'custom' ? customIds : null,
        frequency,
        nextRun: Date.now() + 60 * 1000,
        createdAt: serverTimestamp(),
      });
      onDone();
    } catch {
      onError('Could not create that schedule — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 flex flex-col gap-3">
      <h3 className="font-display font-semibold">New schedule</h3>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Message
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={400} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Audience
        <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
          <option value="all">All active members</option>
          <option value="overdue">Members with overdue contributions</option>
          <option value="loan_holders">Members with active loans</option>
          <option value="admins">Admins only</option>
          <option value="custom">Choose members</option>
        </select>
      </label>
      {audience === 'custom' && (
        <fieldset className="border border-forest-100 rounded-lg p-3 max-h-32 overflow-y-auto">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm py-0.5">
              <input type="checkbox" checked={customIds.includes(m.id)} onChange={() => toggleCustom(m.id)} disabled={busy} />
              {m.name}
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Repeats
        <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <p className="text-xs text-forest-900/50">Starts within about 15 minutes, then repeats on this cadence until paused or deleted.</p>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
          {busy ? 'Saving…' : 'Create schedule'}
        </button>
        <button onClick={onDone} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
          Cancel
        </button>
      </div>
    </div>
  );
}

function TopUpForm({ chamaId, onDone }: { chamaId: string; onDone: () => void }) {
  const [amount, setAmount] = useState('500');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await purchaseSmsCredits({ chamaId, amountKes: Number(amount), phone });
      setStarted(true);
    } catch (e) {
      const { message } = describeCallError(e);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 max-w-sm flex flex-col gap-3">
      <h3 className="font-display font-semibold">Top up SMS credits</h3>
      {started ? (
        <p className="text-sm text-forest-700">Check your phone for the M-Pesa/Airtel Money prompt to complete the payment.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Amount (KES)
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Phone to pay from
            <input type="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
          </label>
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
              {busy ? 'Starting…' : 'Pay'}
            </button>
            <button onClick={onDone} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
        </>
      )}
      {started && (
        <button onClick={onDone} className="text-sm font-semibold text-forest-700 self-start">
          Done
        </button>
      )}
    </div>
  );
}
