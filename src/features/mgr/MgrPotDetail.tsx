import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers, memberName } from '../../app/useMembers';
import { closeMgrPeriod, recordCashMgrPayment, recordMgrPayoutCash, runMgrDraw } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes } from '../../lib/money';
import { lateScore, recentReliability } from '../../lib/mgrEngine';
import { AdminChargeButton } from '../payments/AdminChargeButton';
import type { MgrPot, MgrRecord } from '../../lib/types';

export default function MgrPotDetail() {
  const { potId } = useParams<{ potId: string }>();
  const { chamaId, isFinanceAdmin } = useChama();
  const { members } = useMembers(chamaId, false);
  const [pot, setPot] = useState<MgrPot | null>(null);
  const [records, setRecords] = useState<MgrRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const [payoutInfo, setPayoutInfo] = useState<{ recipients: string[]; shareEach: number } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!chamaId || !potId) return;
    const unsub1 = onSnapshot(doc(db, paths.mgrPot(chamaId, potId)), (snap) => {
      setPot(snap.exists() ? ({ id: snap.id, ...snap.data() } as MgrPot) : null);
    });
    const unsub2 = onSnapshot(collection(db, paths.mgrRecords(chamaId, potId)), (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrRecord));
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, [chamaId, potId]);

  if (!pot || !chamaId || !potId) return <p className="text-forest-900/60">Loading…</p>;

  const cid = chamaId;
  const pid = potId;

  const currentPeriodRecords = records.filter((r) => r.period === pot.period);
  const paidThisPeriod = new Set(currentPeriodRecords.filter((r) => r.status === 'paid').map((r) => r.memberId));

  function handleErr(e: unknown, fallback: string) {
    const { message, isQueued } = describeCallError(e);
    if (isQueued) setQueuedMsg(message);
    else setError(message || fallback);
  }

  async function draw(method: 'smart' | 'random') {
    setBusy(true);
    setError(null);
    try {
      await runMgrDraw({ chamaId: cid, potId: pid, method });
    } catch (e) {
      handleErr(e, 'Could not run the draw.');
    } finally {
      setBusy(false);
    }
  }

  async function recordPaid(memberId: string) {
    setBusy(true);
    setError(null);
    try {
      await recordCashMgrPayment({ chamaId: cid, potId: pid, memberId });
    } catch (e) {
      handleErr(e, 'Could not record the contribution.');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    setError(null);
    try {
      const res = await closeMgrPeriod({ chamaId: cid, potId: pid });
      if (res.roundComplete) setPayoutInfo({ recipients: res.recipients, shareEach: res.shareEach });
    } catch (e) {
      handleErr(e, 'Could not close the period.');
    } finally {
      setBusy(false);
    }
  }

  async function payout() {
    setBusy(true);
    setError(null);
    try {
      await recordMgrPayoutCash({ chamaId: cid, potId: pid });
      setPayoutInfo(null);
    } catch (e) {
      handleErr(e, 'Could not record the payout.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/app/mgr')} className="text-sm font-semibold text-forest-700">
        &larr; All pots
      </button>
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{pot.name}</h1>
        <p className="text-sm text-forest-900/60 mt-1">
          {kes(pot.amount)} · {pot.frequency} · period {pot.period} · <span className="chip bg-forest-50 text-forest-700">{pot.status}</span>
        </p>
      </div>

      {isFinanceAdmin && pot.status === 'draft' && (
        <div className="flex gap-2">
          <button onClick={() => draw('smart')} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full">
            Run smart draw
          </button>
          <button onClick={() => draw('random')} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
            Run random draw
          </button>
        </div>
      )}

      {payoutInfo && isFinanceAdmin && (
        <div className="card p-4 border-gold-300 ring-1 ring-gold-200">
          <h3 className="font-display font-semibold">Round complete — payout due</h3>
          <p className="text-sm text-forest-900/70 mt-1">
            {payoutInfo.recipients.map((m) => memberName(members, m)).join(', ')} — {kes(payoutInfo.shareEach)} each
          </p>
          <button onClick={payout} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full mt-3">
            {busy ? 'Paying…' : 'Confirm cash payout'}
          </button>
        </div>
      )}

      {pot.status === 'active' && !payoutInfo && (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-forest-900/50 text-xs border-b border-forest-100">
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">This period</th>
                  <th className="px-4 py-3 font-medium">Late score</th>
                  <th className="px-4 py-3 font-medium">Recent reliability</th>
                  {isFinanceAdmin && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {pot.memberIds.map((id) => (
                  <tr key={id} className="border-b border-forest-50 last:border-0">
                    <td className="px-4 py-3 font-medium">{memberName(members, id)}</td>
                    <td className="px-4 py-3">
                      {paidThisPeriod.has(id) ? (
                        <span className="chip bg-forest-50 text-forest-700">Paid</span>
                      ) : (
                        <span className="chip bg-forest-50 text-forest-900/50">Not yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{lateScore(records, id)}</td>
                    <td className="px-4 py-3">{recentReliability(records, id)}%</td>
                    {isFinanceAdmin && (
                      <td className="px-4 py-3">
                        {!paidThisPeriod.has(id) && (
                          <div className="flex flex-col gap-2 items-start">
                            <button onClick={() => recordPaid(id)} disabled={busy} className="btn-primary text-xs font-semibold px-3 py-1.5 rounded-full">
                              Record cash
                            </button>
                            <AdminChargeButton chamaId={cid} memberId={id} amount={pot.amount} purpose="mgr_contribution" potId={pid} potPeriod={pot.period} />
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-forest-900/60">Payout queue: {pot.queue.map((m) => memberName(members, m)).join(' → ')}</p>

          {isFinanceAdmin && (
            <button onClick={close} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full">
              {busy ? 'Closing…' : 'Close this period'}
            </button>
          )}
        </>
      )}

      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
      {queuedMsg && <p className="text-sm text-gold-700 font-medium">{queuedMsg}</p>}
    </div>
  );
}
