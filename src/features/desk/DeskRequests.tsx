import { useCallback, useEffect, useState } from 'react';
import { useChama } from '../../app/ChamaProvider';
import {
  createDeskRequest, listDeskRequests, listSupportAgents,
  type DeskRequestCategory, type DeskRequestRow, type SupportAgentRow,
} from '../../lib/callables';
import { describeDeskError } from '../../lib/deskErrors';

const CATEGORIES: { value: DeskRequestCategory; label: string }[] = [
  { value: 'setup', label: 'Setting up my chama' },
  { value: 'import', label: 'Importing members' },
  { value: 'sms', label: 'SMS' },
  { value: 'payments', label: 'Payments' },
  { value: 'reports', label: 'Reports' },
  { value: 'account', label: 'My account' },
  { value: 'other', label: 'Something else' },
];
const TOP = 'COG-0000';

function statusOf(r: DeskRequestRow): { label: string; cls: string } {
  if (r.outboxStatus === 'rejected') return { label: 'Could not be delivered', cls: 'bg-brick-50 text-brick-500' };
  if (r.deskStatus === 'answered') return { label: 'Answered', cls: 'bg-forest-50 text-forest-700' };
  if (r.deskStatus === 'closed') return { label: 'Closed', cls: 'bg-forest-50 text-forest-900/60' };
  if (r.deskStatus === 'open' || r.outboxStatus === 'pulled') return { label: 'With the desk', cls: 'bg-forest-50 text-forest-700' };
  return { label: 'Sent — waiting for the desk', cls: 'bg-forest-50 text-forest-900/60' };
}

/** Desk requests: ask a connected desk (or the company desk) for help, and read their replies. */
export default function DeskRequests() {
  const { chamaId, chamaReady, isFinanceAdmin } = useChama();
  const [requests, setRequests] = useState<DeskRequestRow[] | null>(null);
  const [desks, setDesks] = useState<SupportAgentRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [category, setCategory] = useState<DeskRequestCategory>('other');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [deskCode, setDeskCode] = useState<string>('');
  const [alsoTop, setAlsoTop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    if (!chamaId) return;
    setLoadError(null);
    try {
      const res = await listDeskRequests({ chamaId });
      setRequests(res.requests);
    } catch (e) {
      setLoadError(describeDeskError(e));
    }
    if (isFinanceAdmin) {
      try {
        setDesks((await listSupportAgents({ chamaId })).agents);
      } catch {
        /* the destination list is optional: without it the request simply goes to the default desk */
      }
    }
  }, [chamaId, isFinanceAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!chamaReady || !chamaId) return <p className="text-forest-900/60">Loading…</p>;

  const connected = desks.filter((d) => !d.locked);
  const defaultTarget = connected[0]?.agentCode ?? TOP;

  async function submit() {
    if (!subject.trim() || !message.trim()) {
      setError('Add a subject and a message.');
      return;
    }
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await createDeskRequest({
        chamaId: chamaId!, category, subject: subject.trim(), message: message.trim(), alsoTopDesk: alsoTop,
        deskCode: deskCode || undefined, clientRequestId: attemptId,
      });
      setSent(`Sent to ${res.targetDeskCodes.join(' and ')}. Replies will appear below.`);
      setSubject('');
      setMessage('');
      setAlsoTop(false);
      setAttemptId(crypto.randomUUID());
      await load();
    } catch (e) {
      setError(describeDeskError(e)); // attemptId is kept: pressing Send again retries the SAME request, never a duplicate
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="page-header">
        <h1 className="font-display text-2xl font-semibold">Desk requests</h1>
      </div>

      <div className="card p-5 space-y-3">
        <p className="font-display font-semibold">New request</p>
        <label className="flex flex-col gap-1 text-sm font-medium">
          What is it about?
          <select value={category} onChange={(e) => setCategory(e.target.value as DeskRequestCategory)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100 w-full">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Subject
          <input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100 w-full" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Message
          <textarea value={message} maxLength={2000} rows={5} onChange={(e) => setMessage(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100 w-full" />
        </label>

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-sm font-medium mb-1">Send to</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="desk" checked={deskCode === ''} onChange={() => setDeskCode('')} />
            <span>{connected.length ? <>Your first connected desk (<span className="font-mono">{defaultTarget}</span>)</> : <>The company desk (<span className="font-mono">{TOP}</span>) — you have no connected desk</>}</span>
          </label>
          {connected.map((d) => (
            <label key={d.agentCode} className="flex items-center gap-2 text-sm">
              <input type="radio" name="desk" checked={deskCode === d.agentCode} onChange={() => setDeskCode(d.agentCode)} />
              <span className="font-mono">{d.agentCode}</span>
            </label>
          ))}
          {connected.length > 0 && (
            <label className="flex items-center gap-2 text-sm pt-1">
              <input type="checkbox" checked={alsoTop} onChange={(e) => setAlsoTop(e.target.checked)} />
              <span>Also send to the company desk (<span className="font-mono">{TOP}</span>)</span>
            </label>
          )}
        </fieldset>

        <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50 w-full sm:w-auto">
          {busy ? 'Sending…' : 'Send request'}
        </button>
        {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
        {sent && <p className="text-sm text-forest-700 font-medium">{sent}</p>}
        <p className="text-xs text-forest-900/50">Up to 5 requests a day. Desks check for new requests every 30 minutes.</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-display font-semibold">Your requests</p>
          <button onClick={load} className="text-sm font-semibold text-forest-700">Refresh</button>
        </div>
        {loadError ? (
          <p className="text-sm text-brick-500 font-medium">{loadError}</p>
        ) : requests === null ? (
          <p className="text-sm text-forest-900/60">Loading…</p>
        ) : requests.length === 0 ? (
          <div className="card p-5 text-sm text-forest-900/60">No requests yet. When you send one, its status and the desk's replies show up here.</div>
        ) : (
          requests.map((r) => {
            const st = statusOf(r);
            return (
              <div key={r.id} className="card p-4 space-y-2 min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-sm break-words min-w-0 flex-1">{r.subject}</p>
                  <span className={`chip ${st.cls}`}>{st.label}</span>
                </div>
                <p className="text-xs text-forest-900/50">
                  {new Date(r.createdAt).toLocaleString('en-KE')} · to <span className="font-mono">{r.targetDeskCodes.join(', ')}</span>
                </p>
                <p className="text-sm whitespace-pre-wrap break-words">{r.message}</p>
                {r.error && <p className="text-xs text-brick-500">{r.error}</p>}
                {r.responses.map((x, i) => (
                  <div key={i} className="rounded-lg bg-forest-50 p-3 text-sm">
                    <p className="text-xs text-forest-900/50 mb-1"><span className="font-mono">{x.byDeskCode}</span> · {new Date(x.at).toLocaleString('en-KE')}</p>
                    <p className="whitespace-pre-wrap break-words">{x.text}</p>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
