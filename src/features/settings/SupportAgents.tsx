import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addSupportAgent, listSupportAgents, removeSupportAgent, type SupportAgentRow } from '../../lib/callables';
import { describeDeskError } from '../../lib/deskErrors';

const CODE_RE = /^COG-\d{4,}$/;

/** Settings → Support agents. Chair/treasurer connect up to 5 desks by code; COG-0000 (the company desk) is always present and locked. */
export default function SupportAgents({ chamaId }: { chamaId: string }) {
  const [agents, setAgents] = useState<SupportAgentRow[] | null>(null);
  const [maxDesks, setMaxDesks] = useState(5);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await listSupportAgents({ chamaId });
      setAgents(res.agents);
      setMaxDesks(res.maxDesks);
    } catch (e) {
      setLoadError(describeDeskError(e));
    }
  }, [chamaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connected = (agents ?? []).filter((a) => !a.locked).length;

  async function add() {
    const normalized = code.trim().toUpperCase();
    if (!CODE_RE.test(normalized)) {
      setError('Enter a desk code like COG-0007.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addSupportAgent({ chamaId, agentCode: normalized });
      setCode('');
      await load();
    } catch (e) {
      setError(describeDeskError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(agentCode: string) {
    if (!window.confirm(`Disconnect ${agentCode}? They will no longer be able to help this chama.`)) return;
    setBusy(true);
    setError(null);
    try {
      await removeSupportAgent({ chamaId, agentCode });
      await load();
    } catch (e) {
      setError(describeDeskError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="font-display font-semibold">Support agents</p>
        <Link to="/app/desk-requests" className="text-sm font-semibold text-forest-700 hover:underline shrink-0">
          Desk requests →
        </Link>
      </div>
      <p className="text-xs text-forest-900/50 mb-4">
        A Samuhia desk agent you connect here can help with imports, SMS and reports for this chama, and receives your support requests. Up to {maxDesks} desks.
      </p>

      {loadError ? (
        <div className="text-sm">
          <p className="text-brick-500 font-medium">{loadError}</p>
          <button onClick={load} className="mt-2 text-sm font-semibold text-forest-700">Try again</button>
        </div>
      ) : agents === null ? (
        <p className="text-sm text-forest-900/60">Loading…</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {agents.map((a) => (
            <li key={a.agentCode} className="flex items-center gap-3 min-w-0">
              <span className="chip bg-forest-50 text-forest-700 font-mono shrink-0">{a.agentCode}</span>
              <span className="flex-1 min-w-0 text-sm truncate text-forest-900/70">{a.name || (a.addedAt ? `Connected ${new Date(a.addedAt).toLocaleDateString('en-KE')}` : '')}</span>
              {a.locked ? (
                <span className="text-xs text-forest-900/50 shrink-0" title="The company desk is always connected">🔒 Always on</span>
              ) : (
                <button onClick={() => remove(a.agentCode)} disabled={busy} className="text-sm font-semibold text-brick-500 disabled:opacity-50 shrink-0">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && void add()}
          placeholder="COG-0007"
          aria-label="Desk code"
          disabled={busy || connected >= maxDesks}
          className="px-3 py-2 rounded-lg border border-forest-100 font-mono uppercase w-full sm:flex-1 min-w-0"
        />
        <button
          onClick={add}
          disabled={busy || !code.trim() || connected >= maxDesks}
          className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Connect desk'}
        </button>
      </div>
      {connected >= maxDesks && <p className="text-xs text-forest-900/50 mt-2">You have connected the maximum of {maxDesks} desks. Remove one to add another.</p>}
      {error && <p className="text-sm text-brick-500 font-medium mt-2">{error}</p>}
    </div>
  );
}
