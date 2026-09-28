import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers } from '../../app/useMembers';
import { generateReport, generateStatement, purchasePremiumReportAlaCarte, purchaseReportCredits } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { todayISO } from '../../lib/dates';
import { kes } from '../../lib/money';
import {
  PLANS,
  REPORT_TYPES,
  REPORT_WALLET_BUNDLES,
  premiumAlacartePriceKes,
  type ReportKey,
} from '../../lib/constants';
import type { Chama, ReportAlacartePurchase } from '../../lib/types';
import MyStatementCard from './MyStatementCard';

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

// Raw CSV dumps stay exactly as before: client-side reads from the local
// Firestore cache, so they work offline and cost no credits on any paid plan.
const BULK_EXPORTS = [
  { key: 'members', label: 'Members', collection: (chamaId: string) => paths.members(chamaId) },
  { key: 'contributions', label: 'Contributions', collection: (chamaId: string) => paths.contributions(chamaId) },
  { key: 'loans', label: 'Loans', collection: (chamaId: string) => paths.loans(chamaId) },
  { key: 'transactions', label: 'Transactions', collection: (chamaId: string) => paths.transactions(chamaId) },
] as const;

const RANGE_PRESETS = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'last_quarter', label: 'Last quarter' },
  { key: 'this_fy', label: 'This financial year' },
  { key: 'last_fy', label: 'Last financial year' },
  { key: 'custom', label: 'Custom range…' },
];

const AS_OF_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'last_month', label: 'End of last month' },
  { key: 'last_quarter', label: 'End of last quarter' },
  { key: 'last_fy', label: 'End of last financial year' },
  { key: 'custom', label: 'Pick a date…' },
];

const ALACARTE_WAIT_MS = 3 * 60 * 1000;

/** What this chama has left, described from its own doc. Display only — the server is the source of truth. */
function creditPosition(chama: Chama) {
  const cfg = PLANS[chama.plan];
  const standardUsed = chama.standardReportsUsedThisMonth ?? chama.minutesExportsUsedThisMonth ?? 0;
  const premiumUsed = chama.premiumReportsUsedThisMonth ?? 0;
  const wallet = chama.reportCreditsBalance ?? 0;
  return {
    cfg,
    wallet,
    standardLeft: cfg.standardReportCredits === null ? null : Math.max(0, cfg.standardReportCredits - standardUsed),
    premiumLeft: Math.max(0, cfg.premiumReportCredits - premiumUsed),
    alacarteLeft: cfg.premiumAlacarteCapPerMonth === null ? null : Math.max(0, cfg.premiumAlacarteCapPerMonth - (chama.premiumAlacarteUsedThisMonth ?? 0)),
  };
}

type Mode = 'included' | 'wallet' | 'exhausted' | 'alacarte' | 'alacarte_capped' | 'locked';

function costFor(chama: Chama, key: ReportKey): { mode: Mode; text: string } {
  const spec = REPORT_TYPES[key];
  const p = creditPosition(chama);
  const n = spec.credits;
  const credits = `${n} credit${n === 1 ? '' : 's'}`;

  if (spec.tier === 'standard') {
    if (p.standardLeft === null) return { mode: 'included', text: 'Included — unlimited on your plan.' };
    if (p.standardLeft >= n) return { mode: 'included', text: `Uses ${credits} of your monthly allowance (${p.standardLeft} left).` };
    if (p.wallet >= n) return { mode: 'wallet', text: `Uses ${credits} from your wallet (${p.wallet} in wallet).` };
    return { mode: 'exhausted', text: `Out of credits for this month — top up below to generate this (${credits}).` };
  }

  // Premium
  if (p.cfg.premiumReportCredits === 0) {
    if (!p.cfg.premiumAlacarteCapPerMonth) return { mode: 'locked', text: `Not available on the ${p.cfg.name} plan.` };
    if ((p.alacarteLeft ?? 0) <= 0) {
      return { mode: 'alacarte_capped', text: 'Monthly one-off limit reached. Upgrade to Growth for a monthly premium allowance.' };
    }
    return {
      mode: 'alacarte',
      text: `One-off purchase: ${kes(premiumAlacartePriceKes(key))} (${p.alacarteLeft} one-off left this month). Growth includes a monthly allowance.`,
    };
  }
  if (p.premiumLeft >= n) return { mode: 'included', text: `Uses ${credits} of your monthly premium allowance (${p.premiumLeft} left).` };
  if (p.wallet >= n) return { mode: 'wallet', text: `Uses ${credits} from your wallet (${p.wallet} in wallet).` };
  return { mode: 'exhausted', text: `Premium allowance used up — top up below to generate this (${credits}).` };
}

export default function Reports() {
  const { chama, chamaId, chamaReady } = useChama();
  const { members } = useMembers(chamaId, false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  if (!chamaReady || !chama || !chamaId) return <p className="text-forest-900/60">Loading…</p>;

  const exportsAllowed = PLANS[chama.plan].exportsAllowed;

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
          <p className="text-sm text-ink">Reports and exports aren't available on the {PLANS[chama.plan].name} plan.</p>
          <p className="text-xs text-forest-900/50 mt-1">Upgrade from Plan & Billing to unlock statements, ledgers and financial reports.</p>
        </div>
      ) : (
        <>
          <CreditStrip chama={chama} />

          <div className="card p-6">
            <h3 className="font-display font-semibold mb-1">Raw data exports</h3>
            <p className="text-xs text-forest-900/50 mb-4">Unlimited on your plan, and they work offline — a full CSV of everything currently in each list.</p>
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

          <ReportBuilder chama={chama} chamaId={chamaId} members={members} />
          <WalletTopUp chama={chama} chamaId={chamaId} />
        </>
      )}

      <MyStatementCard />
    </div>
  );
}

function CreditStrip({ chama }: { chama: Chama }) {
  const p = creditPosition(chama);
  return (
    <div className="card p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
      <span>
        <span className="text-forest-900/50">Standard reports: </span>
        <b>{p.standardLeft === null ? 'Unlimited' : `${p.standardLeft} left this month`}</b>
      </span>
      {p.cfg.premiumReportCredits > 0 ? (
        <span>
          <span className="text-forest-900/50">Premium reports: </span>
          <b>{p.premiumLeft} left this month</b>
        </span>
      ) : (
        <span>
          <span className="text-forest-900/50">Premium reports: </span>
          <b>{p.alacarteLeft ? `${p.alacarteLeft} one-off left this month` : 'Growth plan and above'}</b>
        </span>
      )}
      <span>
        <span className="text-forest-900/50">Wallet: </span>
        <b>{p.wallet} credit{p.wallet === 1 ? '' : 's'}</b>
      </span>
    </div>
  );
}

function ReportBuilder({ chama, chamaId, members }: { chama: Chama; chamaId: string; members: { id: string; name: string }[] }) {
  const today = todayISO();
  const keys = (Object.keys(REPORT_TYPES) as ReportKey[]).filter((k) => k !== 'minutes'); // minutes are exported from the Minutes screen
  const [reportKey, setReportKey] = useState<ReportKey>('contribution_ledger');
  const [memberId, setMemberId] = useState('');
  const [preset, setPreset] = useState('this_month');
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [asOf, setAsOf] = useState(today);
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');
  const [encrypt, setEncrypt] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; encrypted: boolean; pinSentTo: number } | null>(null);
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => () => unsub.current?.(), []);

  const spec = REPORT_TYPES[reportKey];
  const pdfOnly = spec.encryptDefault && !spec.encryptOptional;
  const cost = costFor(chama, reportKey);
  const asOfMode = spec.periodMode === 'as_of';
  const presetList = asOfMode ? AS_OF_PRESETS : RANGE_PRESETS;
  const needsAlacarte = cost.mode === 'alacarte';
  const blocked = cost.mode === 'locked' || cost.mode === 'alacarte_capped' || cost.mode === 'exhausted';

  function pickReport(k: ReportKey) {
    setReportKey(k);
    const s = REPORT_TYPES[k];
    setPreset(s.periodMode === 'as_of' ? 'today' : 'this_month');
    if (s.encryptDefault && !s.encryptOptional) setFormat('pdf');
    setEncrypt(s.encryptDefault);
    setError(null);
    setResult(null);
  }

  function periodArgs() {
    return asOfMode
      ? { period: preset, asOf: preset === 'custom' ? asOf : undefined }
      : { period: preset, from: preset === 'custom' ? from : undefined, to: preset === 'custom' ? to : undefined };
  }

  async function generate(alacarteReference?: string) {
    const common = { chamaId, format: pdfOnly ? ('pdf' as const) : format, encrypt: spec.encryptOptional ? encrypt : undefined, alacarteReference };
    if (reportKey === 'member_statement') {
      return generateStatement({ ...common, memberId, ...(periodArgs() as { period: string; from?: string; to?: string }) });
    }
    if (reportKey === 'cashflow') {
      return generateStatement({ ...common, ...(periodArgs() as { period: string; from?: string; to?: string }) });
    }
    return generateReport({
      ...common,
      reportType: reportKey as 'contribution_ledger' | 'arrears_penalties' | 'profit_loss' | 'balance_sheet',
      ...periodArgs(),
    });
  }

  /** Waits for the PAY webhook to flip the one-off purchase to 'success' (or 'failed'). */
  function waitForPurchase(reference: string): Promise<'success' | 'failed'> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub.current?.();
        reject(new Error("We didn't receive the payment confirmation in time. If money left your phone, it will show once it settles — try again in a minute."));
      }, ALACARTE_WAIT_MS);
      unsub.current = onSnapshot(doc(db, paths.reportAlacartePurchase(chamaId, reference)), (snap) => {
        const status = (snap.data() as ReportAlacartePurchase | undefined)?.status;
        if (status === 'success' || status === 'failed') {
          clearTimeout(timer);
          unsub.current?.();
          resolve(status);
        }
      });
    });
  }

  async function submit() {
    setError(null);
    setResult(null);
    if (reportKey === 'member_statement' && !memberId) {
      setError('Choose a member first.');
      return;
    }
    try {
      if (needsAlacarte) {
        if (!phone.trim()) {
          setError('Enter the M-Pesa/Airtel number to pay from.');
          return;
        }
        setBusy('Check your phone and approve the payment…');
        const { reference } = await purchasePremiumReportAlaCarte({
          chamaId,
          reportType: reportKey as 'cashflow' | 'profit_loss' | 'balance_sheet',
          format: pdfOnly ? 'pdf' : format,
          phone,
          ...periodArgs(),
        });
        const outcome = await waitForPurchase(reference);
        if (outcome === 'failed') throw new Error('The payment did not go through, so no report was generated.');
        setBusy('Payment received — generating…');
        setResult(await generate(reference));
      } else {
        setBusy('Generating…');
        setResult(await generate());
      }
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : describeCallError(e).message);
    } finally {
      setBusy(null);
    }
  }

  const field = 'px-3 py-2 rounded-lg border border-forest-100';

  return (
    <div className="card p-6">
      <h3 className="font-display font-semibold mb-1">Generate a report</h3>
      <p className="text-xs text-forest-900/50 mb-4">Pick a report and a period — everything else (pricing, credits, encryption) is handled for you.</p>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          Report
          <select value={reportKey} onChange={(e) => pickReport(e.target.value as ReportKey)} disabled={!!busy} className={field}>
            <optgroup label="Standard">
              {keys.filter((k) => REPORT_TYPES[k].tier === 'standard').map((k) => (
                <option key={k} value={k}>{REPORT_TYPES[k].label}</option>
              ))}
            </optgroup>
            <optgroup label="Financial statements (premium)">
              {keys.filter((k) => REPORT_TYPES[k].tier === 'premium').map((k) => (
                <option key={k} value={k}>{REPORT_TYPES[k].label}</option>
              ))}
            </optgroup>
          </select>
        </label>

        {reportKey === 'member_statement' && (
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Member
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} disabled={!!busy} className={field}>
              <option value="">Choose a member…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm font-medium">
          {asOfMode ? 'As of' : 'Period'}
          <select value={preset} onChange={(e) => setPreset(e.target.value)} disabled={!!busy} className={field}>
            {presetList.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Format
          <select value={pdfOnly ? 'pdf' : format} onChange={(e) => setFormat(e.target.value as 'pdf' | 'csv')} disabled={!!busy || pdfOnly} className={field}>
            <option value="pdf">PDF</option>
            {!pdfOnly && <option value="csv">CSV</option>}
          </select>
        </label>

        {preset === 'custom' && !asOfMode && (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!!busy} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={!!busy} className={field} />
            </label>
          </>
        )}
        {preset === 'custom' && asOfMode && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Date
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} disabled={!!busy} className={field} />
          </label>
        )}

        {needsAlacarte && (
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Pay from (M-Pesa / Airtel Money number)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!!busy} placeholder="07XX XXX XXX" inputMode="tel" className={field} />
          </label>
        )}
      </div>

      {spec.encryptOptional && (pdfOnly ? false : format === 'pdf') && (
        <label className="flex items-center gap-2 text-sm mt-3">
          <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} disabled={!!busy} />
          Protect this PDF with a PIN
        </label>
      )}
      {spec.encryptDefault && (
        <p className="text-xs text-forest-900/50 mt-3">This report is always password-protected. The 6-digit PIN is sent by SMS to your chair and treasurer — free of charge.</p>
      )}

      <p className={`text-sm mt-3 ${blocked ? 'text-brick-500 font-medium' : 'text-forest-700'}`}>{cost.text}</p>

      <button
        onClick={submit}
        disabled={!!busy || cost.mode === 'locked' || cost.mode === 'alacarte_capped' || cost.mode === 'exhausted'}
        className="btn-primary text-sm font-semibold px-4 py-2 rounded-full mt-4 disabled:opacity-50"
      >
        {busy ?? (needsAlacarte ? `Pay ${kes(premiumAlacartePriceKes(reportKey))} & generate` : 'Generate report')}
      </button>

      {error && <p className="text-sm text-brick-500 font-medium mt-2">{error}</p>}
      {result && (
        <div className="text-sm mt-3 space-y-1">
          <p>
            Ready —{' '}
            <a href={result.url} target="_blank" rel="noreferrer" className="font-semibold text-forest-700 underline">
              download the report
            </a>{' '}
            (link expires in 48 hours).
          </p>
          {result.encrypted && (
            <p className={result.pinSentTo > 0 ? 'text-forest-900/60' : 'text-brick-500 font-medium'}>
              {result.pinSentTo > 0
                ? `The PIN was sent by SMS to ${result.pinSentTo} official${result.pinSentTo === 1 ? '' : 's'}.`
                : "We couldn't send the PIN by SMS — check that the chair and treasurer have phone numbers on file."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function WalletTopUp({ chama, chamaId }: { chama: Chama; chamaId: string }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const p = creditPosition(chama);

  async function buy(credits: number) {
    if (!phone.trim()) {
      setError('Enter the M-Pesa/Airtel number to pay from.');
      return;
    }
    setBusy(credits);
    setError(null);
    setStarted(false);
    try {
      await purchaseReportCredits({ chamaId, credits, phone });
      setStarted(true);
    } catch (e) {
      setError(describeCallError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-6">
      <h3 className="font-display font-semibold mb-1">Top up report credits</h3>
      <p className="text-xs text-forest-900/50 mb-4">
        Credits never expire. {p.cfg.premiumReportCredits > 0 ? 'On your plan they cover premium reports once the monthly allowance is used.' : 'On your plan they cover standard reports once the monthly allowance is used.'}
      </p>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" inputMode="tel" className="px-3 py-2 rounded-lg border border-forest-100 text-sm mb-3 w-full sm:w-64" />
      <div className="flex flex-wrap gap-2">
        {Object.entries(REPORT_WALLET_BUNDLES).map(([credits, price]) => (
          <button
            key={credits}
            onClick={() => buy(Number(credits))}
            disabled={busy !== null}
            className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full hover:bg-forest-50 disabled:opacity-50"
          >
            {busy === Number(credits) ? 'Starting…' : `${credits} credit${credits === '1' ? '' : 's'} — ${kes(price)}`}
          </button>
        ))}
      </div>
      {started && <p className="text-sm text-forest-700 mt-3">Check your phone for the payment prompt — your balance updates automatically once it clears.</p>}
      {error && <p className="text-sm text-brick-500 font-medium mt-2">{error}</p>}
    </div>
  );
}
