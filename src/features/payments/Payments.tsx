import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useChama } from '../../app/ChamaProvider';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { setupSettlementAccount, requestSettlementChange, approveSettlementChange, listKenyaBanks } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { PLANS } from '../../lib/constants';
import type { SettlementAccountRequest } from '../../lib/types';

export default function Payments() {
  const { chama, chamaReady, isFinanceAdmin, membership } = useChama();
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
            {isFinanceAdmin && membership?.memberId && (
              <PendingSettlementRequests chamaId={chama.id!} myMemberId={membership.memberId} />
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

/**
 * Pending settlement-account change requests. A change needs a second official,
 * so this is where the other chair/treasurer sees the request and approves or
 * rejects it. The requester sees their own request as "awaiting approval".
 */
function PendingSettlementRequests({ chamaId, myMemberId }: { chamaId: string; myMemberId: string }) {
  const [requests, setRequests] = useState<SettlementAccountRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, paths.settlementAccountRequests(chamaId)), where('status', '==', 'pending')),
      (snap) => setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SettlementAccountRequest)),
      (e) => setError(describeCallError(e).message)
    );
  }, [chamaId]);

  async function decide(r: SettlementAccountRequest, decision: 'approve' | 'reject') {
    if (
      decision === 'approve' &&
      !window.confirm(`Approve changing the settlement account to ${r.accountLabel} (${r.accountNumber})? All future collections will settle there.`)
    ) {
      return;
    }
    setError(null);
    setBusyId(r.id);
    try {
      await approveSettlementChange({ chamaId, requestId: r.id, decision });
    } catch (e) {
      setError(describeCallError(e).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!requests.length && !error) return null;

  return (
    <div className="mt-4 border-t border-forest-100 pt-3 flex flex-col gap-3">
      <p className="text-sm font-semibold text-ink">Pending change requests</p>
      {requests.map((r) => {
        const mine = r.requestedBy === myMemberId;
        return (
          <div key={r.id} className="rounded-lg border border-forest-100 p-3 text-sm">
            <p className="font-medium text-ink">
              {r.accountLabel} · {r.accountNumber}
            </p>
            <p className="text-forest-900/60 mt-0.5">
              {r.accountType === 'bank' ? 'Bank account' : r.accountType === 'till' ? 'M-Pesa Till' : 'M-Pesa Paybill'}
              {r.createdAt ? ` · requested ${new Date(r.createdAt).toLocaleDateString()}` : ''}
            </p>
            {mine ? (
              <p className="text-gold-700 font-medium mt-2">Awaiting approval from another official.</p>
            ) : (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => decide(r, 'approve')}
                  disabled={busyId === r.id}
                  className="btn-primary text-sm font-semibold px-4 py-1.5 rounded-full disabled:opacity-50"
                >
                  {busyId === r.id ? 'Working…' : 'Approve'}
                </button>
                <button
                  onClick={() => decide(r, 'reject')}
                  disabled={busyId === r.id}
                  className="text-sm font-semibold px-4 py-1.5 rounded-full border border-forest-100 text-brick-500 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        );
      })}
      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
    </div>
  );
}

function SettlementForm({ mode, chamaId, onDone }: { mode: 'setup' | 'change'; chamaId: string; onDone: () => void }) {
  const [accountType, setAccountType] = useState<'paybill' | 'till' | 'bank'>('till');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [bankFilter, setBankFilter] = useState('');
  const [banksLoading, setBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Banks are only needed (and only fetched) once, when the bank type is first chosen.
  useEffect(() => {
    if (accountType !== 'bank' || banks.length || banksLoading) return;
    setBanksLoading(true);
    setBanksError(null);
    listKenyaBanks({})
      .then((res) => setBanks(res.banks))
      .catch((e) => setBanksError(describeCallError(e).message))
      .finally(() => setBanksLoading(false));
  }, [accountType, banks.length, banksLoading]);

  const selectedBank = banks.find((b) => b.code === bankCode);
  const filteredBanks = banks.filter((b) => b.code === bankCode || b.name.toLowerCase().includes(bankFilter.trim().toLowerCase()));

  async function submit() {
    setError(null);
    if (accountType === 'paybill') {
      setError('M-Pesa Paybill is currently under maintenance. Choose a bank account or a Till.');
      return;
    }
    if (accountType === 'bank' && !selectedBank) {
      setError('Pick a bank.');
      return;
    }
    if (!accountNumber.trim()) {
      setError('Enter the paybill/till/account number.');
      return;
    }
    const accountLabel = accountType === 'bank' && selectedBank ? selectedBank.name : accountType;
    const code = accountType === 'bank' ? selectedBank?.code : undefined;
    setBusy(true);
    try {
      if (mode === 'setup') {
        await setupSettlementAccount({ chamaId, accountLabel, accountType, accountNumber, bankCode: code });
        setOk('Settlement account set up.');
      } else {
        await requestSettlementChange({ chamaId, accountLabel, accountType, accountNumber, bankCode: code });
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
      {accountType === 'paybill' && (
        <p className="text-sm text-gold-700 font-medium">M-Pesa Paybill is currently under maintenance. Choose a bank account or a Till to collect online.</p>
      )}
      {accountType === 'bank' && (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Bank
            <input
              value={bankFilter}
              onChange={(e) => setBankFilter(e.target.value)}
              placeholder="Type to filter banks"
              disabled={busy || banksLoading}
              className="px-3 py-2 rounded-lg border border-forest-100"
            />
          </label>
          <select
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            disabled={busy || banksLoading}
            aria-label="Bank"
            className="px-3 py-2 rounded-lg border border-forest-100"
          >
            <option value="">{banksLoading ? 'Loading banks…' : 'Select a bank'}</option>
            {filteredBanks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          {banksError && <p className="text-sm text-brick-500 font-medium">{banksError}</p>}
        </>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        {accountType === 'bank' ? 'Account number' : 'Paybill/Till number'}
        <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <button onClick={submit} disabled={busy || accountType === 'paybill'} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full self-start disabled:opacity-50">
        {busy ? 'Saving…' : mode === 'setup' ? 'Set up settlement account' : 'Request change'}
      </button>
      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
      {ok && <p className="text-sm text-forest-700 font-medium">{ok}</p>}
    </div>
  );
}
