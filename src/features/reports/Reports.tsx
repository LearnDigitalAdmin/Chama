import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers } from '../../app/useMembers';
import { generateStatement } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { todayISO } from '../../lib/dates';
import { PLANS } from '../../lib/constants';

// A tiny CSV builder — no library needed for a handful of flat exports.
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

function downloadText(filename: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const BULK_EXPORTS = [
  { key: 'members', label: 'Members', collection: (chamaId: string) => paths.members(chamaId) },
  { key: 'contributions', label: 'Contributions', collection: (chamaId: string) => paths.contributions(chamaId) },
  { key: 'loans', label: 'Loans', collection: (chamaId: string) => paths.loans(chamaId) },
  { key: 'transactions', label: 'Transactions', collection: (chamaId: string) => paths.transactions(chamaId) },
] as const;

export default function Reports() {
  const { chama, chamaId, chamaReady } = useChama();
  const { members } = useMembers(chamaId, false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  if (!chamaReady || !chama || !chamaId) return <p className="text-forest-900/60">Loading…</p>;

  const exportsAllowed = PLANS[chama.plan].exportsAllowed;
  const quota = PLANS[chama.plan].minutesQuota;
  const used = chama.minutesExportsUsedThisMonth ?? 0;

  async function runBulkExport(key: (typeof BULK_EXPORTS)[number]) {
    setBulkBusy(key.key);
    setBulkError(null);
    try {
      const snap = await getDocs(collection(db, key.collection(chamaId!)));
      const rows = snap.docs.map((d) => {
        const data = d.data();
        // Flatten anything nested (schedule arrays etc.) so the CSV stays tabular.
        const flat: Record<string, unknown> = { id: d.id };
        for (const [k, v] of Object.entries(data)) {
          flat[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
        }
        return flat;
      });
      if (!rows.length) {
        setBulkError(`No ${key.label.toLowerCase()} to export yet.`);
        return;
      }
      downloadText(`${chama!.name.replace(/\W+/g, '-')}-${key.key}-${todayISO()}.csv`, toCsv(rows));
    } catch {
      setBulkError('Could not export — please try again.');
    } finally {
      setBulkBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="font-display text-2xl font-semibold">Reports &amp; exports</h1>
      </div>

      {!exportsAllowed ? (
        <div className="card p-5">
          <p className="text-sm text-ink">Exports aren't available on the {PLANS[chama.plan].name} plan.</p>
          <p className="text-xs text-forest-900/50 mt-1">Upgrade from Plan & Billing to unlock data exports and statements.</p>
        </div>
      ) : (
        <>
          <div className="card p-6">
            <h3 className="font-display font-semibold mb-1">Raw data exports</h3>
            <p className="text-xs text-forest-900/50 mb-4">Unlimited on your plan — a full CSV of everything currently in each list.</p>
            <div className="flex flex-wrap gap-2">
              {BULK_EXPORTS.map((e) => (
                <button
                  key={e.key}
                  onClick={() => runBulkExport(e)}
                  disabled={bulkBusy === e.key}
                  className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full hover:bg-forest-50 disabled:opacity-50"
                >
                  {bulkBusy === e.key ? 'Exporting…' : `${e.label}.csv`}
                </button>
              ))}
            </div>
            {bulkError && <p className="text-sm text-brick-500 font-medium mt-2">{bulkError}</p>}
          </div>

          <StatementForm chamaId={chamaId} members={members} quota={quota} used={used} />
        </>
      )}
    </div>
  );
}

function StatementForm({
  chamaId,
  members,
  quota,
  used,
}: {
  chamaId: string;
  members: { id: string; name: string }[];
  quota: number | null;
  used: number;
}) {
  const today = todayISO();
  const [memberId, setMemberId] = useState('');
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const remaining = quota === null ? null : Math.max(0, quota - used);

  async function submit() {
    setError(null);
    setUrl(null);
    setBusy(true);
    try {
      const res = await generateStatement({ chamaId, memberId: memberId || undefined, from, to, format });
      setUrl(res.url);
    } catch (e) {
      setError(describeCallError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <h3 className="font-display font-semibold mb-1">Statement</h3>
      <p className="text-xs text-forest-900/50 mb-4">
        {quota === null ? 'Unlimited exports on your plan.' : `${remaining} of ${quota} free export${quota === 1 ? '' : 's'} left this month — extra exports need a plan upgrade.`}
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Member (leave blank for whole chama)
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
            <option value="">Whole chama</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as 'pdf' | 'csv')} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
        </label>
      </div>
      <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full mt-4 disabled:opacity-50">
        {busy ? 'Generating…' : 'Generate statement'}
      </button>
      {error && <p className="text-sm text-brick-500 font-medium mt-2">{error}</p>}
      {url && (
        <p className="text-sm mt-3">
          Ready —{' '}
          <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-forest-700 underline">
            download the statement
          </a>{' '}
          (link expires in 48 hours).
        </p>
      )}
    </div>
  );
}
