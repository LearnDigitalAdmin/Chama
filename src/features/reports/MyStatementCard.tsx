import { useState } from 'react';
import { useChama } from '../../app/ChamaProvider';
import { generateStatement } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';

const PRESETS: { key: string; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'last_quarter', label: 'Last quarter' },
  { key: 'this_fy', label: 'This financial year' },
  { key: 'last_fy', label: 'Last financial year' },
];

/**
 * A member's OWN statement — free on every plan (including Free) and never
 * touches the chama's report credits. Enforced server-side in
 * generateStatement (is_self_service), not here; this card only offers it.
 * The PDF is always PIN-protected, and the PIN is SMSed to the member.
 */
export default function MyStatementCard() {
  const { chamaId, membership } = useChama();
  const [period, setPeriod] = useState('this_fy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; pinSentTo: number } | null>(null);

  if (!chamaId || !membership) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await generateStatement({ chamaId: chamaId!, memberId: membership!.memberId, period, format: 'pdf' });
      setResult({ url: res.url, pinSentTo: res.pinSentTo });
    } catch (e) {
      setError(describeCallError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <h3 className="font-display font-semibold mb-1">My statement</h3>
      <p className="text-xs text-forest-900/50 mb-4">
        Free for every member. Your PDF is password-protected — the 6-digit PIN is sent to your phone by SMS.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100 text-sm">
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
          {busy ? 'Generating…' : 'Get my statement'}
        </button>
      </div>
      {error && <p className="text-sm text-brick-500 font-medium mt-2">{error}</p>}
      {result && (
        <p className="text-sm mt-3">
          Ready —{' '}
          <a href={result.url} target="_blank" rel="noreferrer" className="font-semibold text-forest-700 underline">
            download your statement
          </a>
          . {result.pinSentTo > 0 ? 'Your PIN was sent by SMS.' : "We couldn't send the PIN by SMS — contact your chama officials."}
        </p>
      )}
    </div>
  );
}
