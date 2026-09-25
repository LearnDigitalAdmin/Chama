import { useState } from 'react';
import { useChama } from '../../app/ChamaProvider';
import { setupSettlementAccount, requestSettlementChange } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { PLANS } from '../../lib/constants';

export default function Payments() {
  const { chama, chamaReady, isFinanceAdmin } = useChama();
  const [showForm, setShowForm] = useState(false);

  if (!chamaReady) return <p className="text-forest-900/60">Loading…</p>;
  if (!chama) return null;

  const canCollectOnline = PLANS[chama.plan].onlineCollection;

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="font-display text-2xl font-semibold">Payments &amp; Settlement</h1>
      </div>

      {!canCollectOnline && (
        <div className="card p-4 border-gold-300 ring-1 ring-gold-200">
          <p className="text-sm text-ink font-medium">Online collections aren't included on the {PLANS[chama.plan].name} plan.</p>
          <p className="text-sm text-forest-900/60 mt-1">Members can still pay in cash — upgrade the plan to accept M-Pesa/Airtel Money directly.</p>
        </div>
      )}

      <div className="card p-5 max-w-lg">
        <h3 className="font-display font-semibold">Settlement account</h3>
        {chama.settlementSplitCode ? (
          <>
            <p className="text-sm text-forest-900/70 mt-1">
              Collections settle to: <span className="font-medium text-ink">{chama.settlementAccount}</span>
            </p>
            {isFinanceAdmin && !showForm && (
              <button onClick={() => setShowForm(true)} className="text-sm font-semibold text-forest-700 mt-2">
                Request a change
              </button>
            )}
            {showForm && isFinanceAdmin && (
              <SettlementForm mode="change" chamaId={chama.id!} onDone={() => setShowForm(false)} />
            )}
          </>
        ) : isFinanceAdmin ? (
          <SettlementForm mode="setup" chamaId={chama.id!} onDone={() => {}} />
        ) : (
          <p className="text-sm text-forest-900/60 mt-1">Not set up yet — ask the chair to add one.</p>
        )}
      </div>
    </div>
  );
}

function SettlementForm({ mode, chamaId, onDone }: { mode: 'setup' | 'change'; chamaId: string; onDone: () => void }) {
  const [accountType, setAccountType] = useState<'paybill' | 'till' | 'bank'>('paybill');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!accountNumber.trim()) {
      setError('Enter the paybill/till/account number.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'setup') {
        await setupSettlementAccount({ chamaId, accountLabel: accountType, accountType, accountNumber, bankCode: bankCode || undefined });
        setOk('Settlement account set up.');
      } else {
        await requestSettlementChange({ chamaId, accountLabel: accountType, accountType, accountNumber, bankCode: bankCode || undefined });
        setOk('Change requested — needs approval from another official.');
      }
      setTimeout(onDone, 1500);
    } catch (e) {
      const { message } = describeCallError(e);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-forest-100 pt-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Account type
        <select value={accountType} onChange={(e) => setAccountType(e.target.value as typeof accountType)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
          <option value="paybill">M-Pesa Paybill</option>
          <option value="till">M-Pesa Till</option>
          <option value="bank">Bank account</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {accountType === 'bank' ? 'Account number' : 'Paybill/Till number'}
        <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      {accountType === 'bank' && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Bank code
          <input value={bankCode} onChange={(e) => setBankCode(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
        </label>
      )}
      <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full self-start disabled:opacity-50">
        {busy ? 'Saving…' : mode === 'setup' ? 'Set up settlement account' : 'Request change'}
      </button>
      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
      {ok && <p className="text-sm text-forest-700 font-medium">{ok}</p>}
    </div>
  );
}
