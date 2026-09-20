import { useState } from 'react';
import { useChama } from '../../app/ChamaProvider';
import { useMembers } from '../../app/useMembers';
import { sendSmsCampaign, purchaseSmsCredits } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';

export default function Communication() {
  const { chama, chamaId, chamaReady } = useChama();
  const { members } = useMembers(chamaId, false);
  const [audience, setAudience] = useState<'all' | 'overdue' | 'custom'>('all');
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; creditsUsed: number } | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">Communication</h1>
        <div className="card px-4 py-2 flex items-center gap-3">
          <div>
            <p className="text-xs text-forest-900/50">SMS credits</p>
            <p className="font-display font-semibold">{(chama.smsCredits ?? 0).toLocaleString()}</p>
          </div>
          <button onClick={() => setShowTopUp(true)} className="text-sm font-semibold text-forest-700">
            Top up
          </button>
        </div>
      </div>

      {showTopUp && chamaId && <TopUpForm chamaId={chamaId} onDone={() => setShowTopUp(false)} />}

      <div className="card p-5 max-w-lg flex flex-col gap-3">
        <h3 className="font-display font-semibold">Send SMS</h3>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Audience
          <select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
            <option value="all">All active members</option>
            <option value="overdue">Members with overdue contributions</option>
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
        <p className="text-xs text-forest-900/50">{message.length}/400 characters</p>
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
