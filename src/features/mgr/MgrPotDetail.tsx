import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers, memberName, memberPhone } from '../../app/useMembers';
import {
  closeMgrPeriod,
  recordCashMgrPayment,
  recordMgrPayoutCash,
  runMgrDraw,
  mgrAddMembers,
  mgrRemoveMember,
  mgrReorderQueue,
  mgrToggleAutoDemote,
  mgrSettleArrear,
  mgrWriteOffArrear,
  mgrCoverShortfall,
  mgrExitMember,
  mgrSettleExitRefund,
  mgrSettleExitClawback,
  mgrRepairPot,
  mgrCloseForever,
  mgrStartNewCycle,
  generateStatement,
} from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes } from '../../lib/money';
import { lateScore, recentReliability, healthCheck, previewSmartOrder, isShortRound } from '../../lib/mgrEngine';
import { Spinner } from '../../components/Spinner';
import { AdminChargeButton } from '../payments/AdminChargeButton';
import type { MgrArrear, MgrExit, MgrPayout, MgrPot, MgrRecord } from '../../lib/types';

const STATUS_COPY: Record<MgrPot['status'], string> = {
  draft: 'Draft — draw not run yet',
  active: 'Active',
  completed: 'Cycle complete',
  closed: 'Closed',
};

const FINAL_POLICY_COPY: Record<'split' | 'carry_over' | 'close_early', string> = {
  split: "This pot splits whatever's collected evenly across who's left.",
  carry_over: 'This pot pays everyone their full share, then starts a new cycle automatically.',
  close_early: 'This pot pays everyone their full share, then rests once this cycle is done.',
};

export default function MgrPotDetail() {
  const { potId } = useParams<{ potId: string }>();
  const { chamaId, isFinanceAdmin } = useChama();
  const { members } = useMembers(chamaId, false);
  const [pot, setPot] = useState<MgrPot | null>(null);
  const [records, setRecords] = useState<MgrRecord[]>([]);
  const [arrears, setArrears] = useState<MgrArrear[]>([]);
  const [payouts, setPayouts] = useState<MgrPayout[]>([]);
  const [exits, setExits] = useState<MgrExit[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [payoutInfo, setPayoutInfo] = useState<{ recipients: string[]; shareEach: number; poolShortfall: number } | null>(null);

  // Queue reorder editor — only committed to the server on "Save order".
  const [queueDraft, setQueueDraft] = useState<string[] | null>(null);
  const [addPicker, setAddPicker] = useState<string[] | null>(null); // non-null while "Add members" modal is open
  // Confirm-before-removing modal — mirrors the demo's openMgrRemoveMember:
  // shows what this member has contributed/received (computed client-side
  // from records/payouts we already have) and lets the cut % be overridden
  // for this one removal, before mgrExitMember actually takes them out.
  const [exitConfirmFor, setExitConfirmFor] = useState<{ memberId: string; contributed: number; received: number } | null>(null);
  const [exitCutInput, setExitCutInput] = useState<number>(0);
  const [settleRefundId, setSettleRefundId] = useState<string | null>(null);
  const [settleClawbackId, setSettleClawbackId] = useState<string | null>(null);
  const [settleArrearId, setSettleArrearId] = useState<string | null>(null);
  const [writeOffArrearId, setWriteOffArrearId] = useState<string | null>(null);
  const [shortfallAmount, setShortfallAmount] = useState<number>(0);
  const [shortfallSource, setShortfallSource] = useState<'reserve' | 'member'>('reserve');
  const [shortfallMember, setShortfallMember] = useState<string>('');
  const [acknowledgeShortfall, setAcknowledgeShortfall] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    if (!chamaId || !potId) return;
    const unsub1 = onSnapshot(doc(db, paths.mgrPot(chamaId, potId)), (snap) => {
      setPot(snap.exists() ? ({ id: snap.id, ...snap.data() } as MgrPot) : null);
    });
    const unsub2 = onSnapshot(collection(db, paths.mgrRecords(chamaId, potId)), (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrRecord));
    });
    const unsub3 = onSnapshot(collection(db, paths.mgrArrears(chamaId, potId)), (snap) => {
      setArrears(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrArrear));
    });
    const unsub4 = onSnapshot(collection(db, paths.mgrPayouts(chamaId, potId)), (snap) => {
      setPayouts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrPayout));
    });
    const unsub5 = onSnapshot(collection(db, paths.mgrExits(chamaId, potId)), (snap) => {
      setExits(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrExit));
    });
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsub5();
    };
  }, [chamaId, potId]);

  const findings = useMemo(() => (pot ? healthCheck(pot, arrears) : []), [pot, arrears]);
  const openArrears = arrears.filter((a) => a.status === 'open');
  const openExits = exits.filter((x) => x.status === 'open');

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

  async function run<T>(key: string, fn: () => Promise<T>, onOk?: (r: T) => void, fallback = 'That action failed.') {
    setBusyKey(key);
    setError(null);
    try {
      const r = await fn();
      onOk?.(r);
    } catch (e) {
      handleErr(e, fallback);
    } finally {
      setBusyKey(null);
    }
  }

  const draw = (method: 'smart' | 'random') => run('draw', () => runMgrDraw({ chamaId: cid, potId: pid, method }));

  const recordPaid = (memberId: string) => run(`pay-${memberId}`, () => recordCashMgrPayment({ chamaId: cid, potId: pid, memberId }));

  const close = () =>
    run('close', () => closeMgrPeriod({ chamaId: cid, potId: pid }), (res) => {
      if (res.roundComplete) setPayoutInfo({ recipients: res.recipients, shareEach: res.shareEach, poolShortfall: res.poolShortfall });
    });

  const payout = () =>
    run('payout', () => recordMgrPayoutCash({ chamaId: cid, potId: pid, acknowledgeShortfall }), (res) => {
      setPayoutInfo(null);
      setAcknowledgeShortfall(false);
      if (res.cycleStarted) setInfoMsg(`Everyone's been paid — cycle ${res.cycleStarted} started automatically. Run the draw to set the new order.`);
    });

  const coverShortfall = () =>
    run('shortfall', () =>
      mgrCoverShortfall({
        chamaId: cid,
        potId: pid,
        amount: shortfallAmount,
        source: shortfallSource,
        memberId: shortfallSource === 'member' ? shortfallMember : undefined,
      })
    );

  const repair = () => run('repair', () => mgrRepairPot({ chamaId: cid, potId: pid }));

  const toggleAutoDemote = () => run('autoDemote', () => mgrToggleAutoDemote({ chamaId: cid, potId: pid }));

  const closeForever = () => {
    if (!confirm(`Close "${pot.name}" for good? This can't be undone.`)) return;
    run('closeForever', () => mgrCloseForever({ chamaId: cid, potId: pid }), () => navigate('/app/mgr'));
  };

  const removeMember = (memberId: string) => {
    if (!confirm(`Remove ${memberName(members, memberId)} from this pot?`)) return;
    run(`remove-${memberId}`, () => mgrRemoveMember({ chamaId: cid, potId: pid, memberId }));
  };

  const addMembers = () =>
    run('addMembers', () => mgrAddMembers({ chamaId: cid, potId: pid, memberIds: addPicker ?? [] }), () => setAddPicker(null));

  const saveQueue = () =>
    run('reorder', () => mgrReorderQueue({ chamaId: cid, potId: pid, queue: queueDraft ?? pot.queue }), () => setQueueDraft(null));

  const moveInDraft = (index: number, dir: -1 | 1) => {
    const q = [...(queueDraft ?? pot.queue)];
    const j = index + dir;
    if (j < 0 || j >= q.length) return;
    [q[index], q[j]] = [q[j], q[index]];
    setQueueDraft(q);
  };

  // Client-side projection of what a member has contributed/received this
  // cycle — same read-only "trusted preview" pattern as lateScore/
  // recentReliability above; mgrExitMember re-derives the real numbers
  // server-side rather than trusting this. Lets the confirm dialog show
  // real figures without a round trip, mirroring the demo's
  // openMgrRemoveMember.
  function memberExitPreview(memberId: string) {
    const contributed = records.filter((r) => r.memberId === memberId && r.status === 'paid').reduce((s, r) => s + r.amount, 0);
    const received = payouts.filter((p) => p.memberId === memberId).reduce((s, p) => s + p.amount, 0);
    return { contributed: Math.round(contributed * 100) / 100, received: Math.round(received * 100) / 100 };
  }

  const openExitConfirm = (memberId: string) => {
    setExitCutInput(pot.exitCutPercent ?? 0);
    setExitConfirmFor({ memberId, ...memberExitPreview(memberId) });
  };

  const confirmExit = () =>
    exitConfirmFor &&
    run(
      `exit-${exitConfirmFor.memberId}`,
      () => mgrExitMember({ chamaId: cid, potId: pid, memberId: exitConfirmFor.memberId, cutPercent: exitCutInput }),
      () => setExitConfirmFor(null)
    );

  const settleRefund = (exitId: string, amount: number) =>
    run(`settleRefund-${exitId}`, () => mgrSettleExitRefund({ chamaId: cid, potId: pid, exitId, amount }), () => setSettleRefundId(null));

  const settleClawback = (exitId: string, amount: number) =>
    run(`settleClawback-${exitId}`, () => mgrSettleExitClawback({ chamaId: cid, potId: pid, exitId, amount }), () => setSettleClawbackId(null));

  const settleArrear = (arrearId: string, amount?: number) =>
    run(`settleArrear-${arrearId}`, () => mgrSettleArrear({ chamaId: cid, potId: pid, arrearId, amount }), () => setSettleArrearId(null));

  const writeOffArrear = (arrearId: string, reason: string) =>
    run(`writeOff-${arrearId}`, () => mgrWriteOffArrear({ chamaId: cid, potId: pid, arrearId, reason }), () => setWriteOffArrearId(null));

  const startNewCycle = () => {
    if (!confirm(`Start cycle ${(pot.cycleNumber ?? 1) + 1} of "${pot.name}"? Everyone goes back into the queue for a fresh draw.`)) return;
    run('newCycle', () => mgrStartNewCycle({ chamaId: cid, potId: pid }), (r) => setInfoMsg(`Cycle ${r.cycleNumber} started — run the draw to set the new order.`));
  };

  const toggleReminders = async () => {
    setBusyKey('reminders');
    setError(null);
    try {
      if (pot.remindersEnabled && pot.reminderScheduleId) {
        await deleteDoc(doc(db, paths.smsSchedules(cid), pot.reminderScheduleId));
        await updateDoc(doc(db, paths.mgrPot(cid, pid)), { remindersEnabled: false, reminderScheduleId: null });
      } else {
        const scheduleRef = doc(collection(db, paths.smsSchedules(cid)));
        await setDoc(scheduleRef, {
          status: 'active',
          body: `Reminder: your ${pot.name} contribution of ${kes(pot.amount)} is due.`,
          audience: 'custom',
          memberIds: pot.memberIds.filter((m) => !paidThisPeriod.has(m)),
          frequency: pot.frequency,
          nextRun: Date.now() + 60 * 1000,
          potId: pid,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, paths.mgrPot(cid, pid)), { remindersEnabled: true, reminderScheduleId: scheduleRef.id });
      }
    } catch (e) {
      handleErr(e, 'Could not update reminders.');
    } finally {
      setBusyKey(null);
    }
  };

  const downloadStatement = async () => {
    setBusyKey('statement');
    setError(null);
    try {
      const { url } = await generateStatement({ chamaId: cid, potId: pid, format: 'csv' });
      window.open(url, '_blank');
    } catch (e) {
      handleErr(e, 'Could not generate the statement.');
    } finally {
      setBusyKey(null);
    }
  };

  const availableToAdd = members.filter((m) => m.status === 'active' && !pot.memberIds.includes(m.id));
  const short = isShortRound(pot);
  const displayQueue = queueDraft ?? pot.queue;

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/app/mgr')} className="text-sm font-semibold text-forest-700">
        &larr; All pots
      </button>

      <div className="mgr-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{pot.name}</h1>
          <p className="text-sm text-white/80 mt-1">
            {kes(pot.amount)} · {pot.frequency} · period {pot.period} · {STATUS_COPY[pot.status]}
          </p>
        </div>
        {isFinanceAdmin && pot.status !== 'closed' && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setAddPicker([])} className="btn-add text-xs">+ Add members</button>
            <button onClick={downloadStatement} disabled={busyKey === 'statement'} className="btn-add text-xs flex items-center gap-1.5">
              {busyKey === 'statement' && <Spinner />} Statement
            </button>
            <button onClick={toggleReminders} disabled={busyKey === 'reminders'} className="btn-add text-xs flex items-center gap-1.5">
              {busyKey === 'reminders' && <Spinner />} {pot.remindersEnabled ? 'Reminders: on' : 'Reminders: off'}
            </button>
          </div>
        )}
      </div>

      {isFinanceAdmin && findings.length > 0 && (
        <div className="card p-4 border-gold-300 ring-1 ring-gold-200">
          <h3 className="font-display font-semibold">Health check</h3>
          <ul className="text-sm text-forest-900/70 mt-2 space-y-1 list-disc pl-5">
            {findings.map((f, i) => (
              <li key={i}>{f.memberId ? `${memberName(members, f.memberId)}: ` : ''}{f.message}</li>
            ))}
          </ul>
          {findings.some((f) => ['duplicate_in_queue', 'orphaned_in_queue', 'missing_from_queue'].includes(f.code)) && (
            <button onClick={repair} disabled={busyKey === 'repair'} className="btn-primary text-xs font-semibold px-3 py-1.5 rounded-full mt-3 flex items-center gap-2">
              {busyKey === 'repair' && <Spinner />} {busyKey === 'repair' ? 'Repairing…' : 'Repair queue'}
            </button>
          )}
        </div>
      )}

      {pot.pendingShortfall != null && pot.pendingShortfall > 0 && isFinanceAdmin && (
        <div className="card p-4 border-brick-300 ring-1 ring-brick-200">
          <h3 className="font-display font-semibold text-brick-500">Round shortfall — {kes(pot.pendingShortfall)}</h3>
          <p className="text-sm text-forest-900/70 mt-1">The last completed round collected less than it promised out. Record how the gap is being covered before paying out.</p>
          <div className="flex flex-wrap gap-2 items-end mt-3">
            <label className="text-xs">
              Amount
              <input type="number" value={shortfallAmount} onChange={(e) => setShortfallAmount(Number(e.target.value))} className="block border border-forest-200 rounded-lg px-2 py-1 mt-1 w-28" />
            </label>
            <label className="text-xs">
              Source
              <select value={shortfallSource} onChange={(e) => setShortfallSource(e.target.value as 'reserve' | 'member')} className="block border border-forest-200 rounded-lg px-2 py-1 mt-1">
                <option value="reserve">Chama reserve</option>
                <option value="member">A member</option>
              </select>
            </label>
            {shortfallSource === 'member' && (
              <label className="text-xs">
                Member
                <select value={shortfallMember} onChange={(e) => setShortfallMember(e.target.value)} className="block border border-forest-200 rounded-lg px-2 py-1 mt-1">
                  <option value="">Select…</option>
                  {pot.memberIds.map((id) => <option key={id} value={id}>{memberName(members, id)}</option>)}
                </select>
              </label>
            )}
            <button onClick={coverShortfall} disabled={busyKey === 'shortfall' || shortfallAmount <= 0} className="btn-primary text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-2">
              {busyKey === 'shortfall' && <Spinner />} Record cover
            </button>
          </div>
        </div>
      )}

      {isFinanceAdmin && pot.status === 'draft' && (
        <div className="flex gap-2">
          <button onClick={() => draw('smart')} disabled={!!busyKey} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full flex items-center gap-2">
            {busyKey === 'draw' && <Spinner />} Run smart draw
          </button>
          <button onClick={() => draw('random')} disabled={!!busyKey} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
            Run random draw
          </button>
        </div>
      )}

      {payoutInfo && isFinanceAdmin && (
        <div className="card p-4 border-gold-300 ring-1 ring-gold-200">
          <h3 className="font-display font-semibold">Round complete — payout due{short ? ' (final settlement, short round)' : ''}</h3>
          <p className="text-sm text-forest-900/70 mt-1">
            {payoutInfo.recipients.map((m) => memberName(members, m)).join(', ')} — {kes(payoutInfo.shareEach)} each
          </p>
          {short && (
            <p className="text-xs text-forest-900/60 mt-2">
              {FINAL_POLICY_COPY[pot.finalRoundPolicy ?? 'split']}
              {pot.finalRoundPolicy && pot.finalRoundPolicy !== 'split' ? ' Paid in full — never a reduced split.' : ''}
            </p>
          )}
          {payoutInfo.poolShortfall > 0 && (
            <label className="flex items-start gap-2 text-xs text-brick-500 bg-brick-50 rounded-lg p-2 mt-2">
              <input type="checkbox" checked={acknowledgeShortfall} onChange={(e) => setAcknowledgeShortfall(e.target.checked)} className="mt-0.5" />
              <span>This round is short by {kes(payoutInfo.poolShortfall)} and it hasn't been covered yet — pay out anyway.</span>
            </label>
          )}
          <button
            onClick={payout}
            disabled={!!busyKey || (payoutInfo.poolShortfall > 0 && !acknowledgeShortfall)}
            className="btn-primary text-sm font-semibold px-4 py-2 rounded-full mt-3 flex items-center gap-2"
          >
            {busyKey === 'payout' && <Spinner />} {busyKey === 'payout' ? 'Paying…' : 'Confirm cash payout'}
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
                        <div className="flex flex-col gap-2 items-start">
                          {!paidThisPeriod.has(id) && (
                            <>
                              <button onClick={() => recordPaid(id)} disabled={!!busyKey} className="btn-primary text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-2">
                                {busyKey === `pay-${id}` && <Spinner />} Record cash
                              </button>
                              <AdminChargeButton
                                chamaId={cid}
                                memberId={id}
                                memberPhone={memberPhone(members, id)}
                                amount={pot.amount}
                                purpose="mgr_contribution"
                                potId={pid}
                                potPeriod={pot.period}
                              />
                            </>
                          )}
                          <div className="flex gap-2">
                            <button onClick={() => removeMember(id)} disabled={!!busyKey} className="text-xs text-forest-900/40 hover:text-brick-500">
                              Remove
                            </button>
                            <button onClick={() => openExitConfirm(id)} disabled={!!busyKey} className="text-xs text-forest-900/40 hover:text-brick-500">
                              Exit
                            </button>
                          </div>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-sm">Payout queue</h3>
              {isFinanceAdmin && (
                <label className="flex items-center gap-2 text-xs text-forest-900/60">
                  <input type="checkbox" checked={pot.autoDemoteLate} onChange={toggleAutoDemote} disabled={busyKey === 'autoDemote'} />
                  Auto-demote late payers
                </label>
              )}
            </div>
            <ol className="text-sm text-forest-900/70 mt-2 flex flex-col gap-1">
              {displayQueue.map((m, i) => (
                <li key={m + i} className="flex items-center gap-2">
                  <span className="w-5 text-forest-900/40">{i + 1}.</span>
                  <span className="flex-1">{memberName(members, m)}</span>
                  {isFinanceAdmin && (
                    <span className="flex gap-1">
                      <button onClick={() => moveInDraft(i, -1)} disabled={i === 0} className="text-xs px-1.5 text-forest-900/40 hover:text-forest-700 disabled:opacity-20">▲</button>
                      <button onClick={() => moveInDraft(i, 1)} disabled={i === displayQueue.length - 1} className="text-xs px-1.5 text-forest-900/40 hover:text-forest-700 disabled:opacity-20">▼</button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {isFinanceAdmin && (
              <div className="flex gap-2 mt-3">
                <button onClick={() => setQueueDraft(previewSmartOrder(records, pot.queue))} className="text-xs font-semibold text-forest-700">
                  Suggest smart order
                </button>
                {queueDraft && (
                  <>
                    <button onClick={saveQueue} disabled={busyKey === 'reorder'} className="btn-primary text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-2">
                      {busyKey === 'reorder' && <Spinner />} Save order
                    </button>
                    <button onClick={() => setQueueDraft(null)} className="text-xs text-forest-900/50">Cancel</button>
                  </>
                )}
              </div>
            )}
          </div>

          {isFinanceAdmin && (
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={close} disabled={!!busyKey} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full flex items-center gap-2">
                {busyKey === 'close' && <Spinner />} {busyKey === 'close' ? 'Closing…' : 'Close this period'}
              </button>
              <button
                onClick={() => {
                  if (!confirm('Re-draw the remaining queue? This reshuffles who\'s left — anyone already paid out stays out.')) return;
                  draw('smart');
                }}
                disabled={!!busyKey}
                className="text-xs font-semibold text-forest-700 flex items-center gap-1"
              >
                {busyKey === 'draw' && <Spinner className="spinner-dark" />} Re-draw remaining queue
              </button>
            </div>
          )}
        </>
      )}

      {pot.status === 'completed' && isFinanceAdmin && (
        <div className="card p-4 border-forest-300 ring-1 ring-forest-200">
          <h3 className="font-display font-semibold">Cycle {pot.cycleNumber} complete</h3>
          <p className="text-sm text-forest-900/70 mt-1">Everyone's had their turn. Start a new cycle to keep this merry-go-round running — records, arrears and reliability history all carry over — or close it for good below.</p>
          <button onClick={startNewCycle} disabled={!!busyKey} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full mt-3 flex items-center gap-2">
            {busyKey === 'newCycle' && <Spinner />} Start cycle {(pot.cycleNumber ?? 1) + 1}
          </button>
        </div>
      )}

      {openArrears.length > 0 && isFinanceAdmin && (
        <div className="card p-4">
          <h3 className="font-display font-semibold text-sm">Open arrears</h3>
          <ul className="mt-2 divide-y divide-forest-50">
            {openArrears.map((a) => (
              <li key={a.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{memberName(members, a.memberId)} — {kes(a.amount)} ({a.periods.length} period{a.periods.length > 1 ? 's' : ''})</span>
                <span className="flex gap-2">
                  {settleArrearId === a.id ? (
                    <SettleArrearForm amount={a.amount} busy={busyKey === `settleArrear-${a.id}`} onCancel={() => setSettleArrearId(null)} onSubmit={(amt) => settleArrear(a.id, amt)} />
                  ) : writeOffArrearId === a.id ? (
                    <WriteOffForm busy={busyKey === `writeOff-${a.id}`} onCancel={() => setWriteOffArrearId(null)} onSubmit={(reason) => writeOffArrear(a.id, reason)} />
                  ) : (
                    <>
                      <button onClick={() => setSettleArrearId(a.id)} className="text-xs font-semibold text-forest-700">Settle</button>
                      <button onClick={() => setWriteOffArrearId(a.id)} className="text-xs text-forest-900/40 hover:text-brick-500">Write off</button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openExits.length > 0 && isFinanceAdmin && (
        <div className="card p-4">
          <h3 className="font-display font-semibold text-sm">Open exits</h3>
          <ul className="mt-2 divide-y divide-forest-50">
            {openExits.map((x) => {
              const refundOutstanding = Math.round((x.refundDue - x.refundPaid) * 100) / 100;
              const clawbackOutstanding = Math.round((x.clawbackDue - x.clawbackRecovered) * 100) / 100;
              return (
                <li key={x.id} className="py-2.5 flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{memberName(members, x.memberId)}</span>
                  {refundOutstanding > 0.01 && (
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-forest-900/60">Refund owed to them — {kes(refundOutstanding)} left{x.cutAmount > 0 ? ` (${x.exitCutPercent}% cut already withheld)` : ''}</span>
                      {settleRefundId === x.id ? (
                        <SettleArrearForm amount={refundOutstanding} busy={busyKey === `settleRefund-${x.id}`} onCancel={() => setSettleRefundId(null)} onSubmit={(amt) => settleRefund(x.id, amt)} />
                      ) : (
                        <button onClick={() => setSettleRefundId(x.id)} className="text-xs font-semibold text-forest-700">Pay refund</button>
                      )}
                    </span>
                  )}
                  {clawbackOutstanding > 0.01 && (
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-forest-900/60">Owed back to the pot — {kes(clawbackOutstanding)} left</span>
                      {settleClawbackId === x.id ? (
                        <SettleArrearForm amount={clawbackOutstanding} busy={busyKey === `settleClawback-${x.id}`} onCancel={() => setSettleClawbackId(null)} onSubmit={(amt) => settleClawback(x.id, amt)} />
                      ) : (
                        <button onClick={() => setSettleClawbackId(x.id)} className="text-xs font-semibold text-forest-700">Record recovery</button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {isFinanceAdmin && (records.length > 0 || payouts.length > 0) && (
        <div className="card p-4">
          <h3 className="font-display font-semibold text-sm">Books</h3>
          {(() => {
            const collected = records.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0);
            const paidOut = payouts.reduce((s, p) => s + p.amount, 0);
            return (
              <dl className="text-sm grid grid-cols-3 gap-y-1 mt-2">
                <dt className="text-forest-900/50">Collected</dt>
                <dd className="num col-span-2">{kes(collected)}</dd>
                <dt className="text-forest-900/50">Paid out</dt>
                <dd className="num col-span-2">{kes(paidOut)}</dd>
                <dt className="text-forest-900/50">Balance</dt>
                <dd className="num col-span-2 font-semibold">{kes(collected - paidOut)}</dd>
                <dt className="text-forest-900/50">Entries</dt>
                <dd className="num col-span-2">{records.length} contributions · {payouts.length} payouts</dd>
              </dl>
            );
          })()}
          {payouts.length > 0 && (
            <>
              <p className="text-xs font-semibold text-forest-900/50 uppercase tracking-wide mt-4 mb-1">Payout history</p>
              <ul className="divide-y divide-forest-50">
                {[...payouts]
                  .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
                  .map((p) => (
                    <li key={p.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                      <span>Round {p.round} — {memberName(members, p.memberId)}</span>
                      <span className="num">{kes(p.amount)}</span>
                      <span className="text-xs text-forest-900/40 whitespace-nowrap">{p.date}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </div>
      )}

      {isFinanceAdmin && pot.status !== 'closed' && (
        <button onClick={closeForever} disabled={!!busyKey} className="text-xs text-forest-900/40 hover:text-brick-500 flex items-center gap-2">
          {busyKey === 'closeForever' && <Spinner className="spinner-dark" />} Close this pot forever
        </button>
      )}

      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
      {queuedMsg && <p className="text-sm text-gold-700 font-medium">{queuedMsg}</p>}
      {infoMsg && <p className="text-sm text-forest-700 font-medium">{infoMsg}</p>}

      {addPicker !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAddPicker(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-forest-900">Add members to {pot.name}</h3>
            <div className="max-h-64 overflow-y-auto flex flex-col gap-1">
              {availableToAdd.length === 0 && <p className="text-xs text-forest-900/50">Every active member is already in this pot.</p>}
              {availableToAdd.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={addPicker.includes(m.id)}
                    onChange={(e) => setAddPicker(e.target.checked ? [...addPicker, m.id] : addPicker.filter((id) => id !== m.id))}
                  />
                  {m.name}
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setAddPicker(null)} className="text-xs font-semibold px-3 py-1.5 rounded-full text-forest-900/60 hover:bg-forest-50">Cancel</button>
              <button onClick={addMembers} disabled={busyKey === 'addMembers' || addPicker.length === 0} className="btn-primary text-xs font-semibold px-4 py-1.5 rounded-full disabled:opacity-50 flex items-center gap-2">
                {busyKey === 'addMembers' && <Spinner />} Add {addPicker.length || ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {exitConfirmFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setExitConfirmFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-forest-900">Remove {memberName(members, exitConfirmFor.memberId)}?</h3>
            <p className="text-sm text-forest-900/70">
              They leave the pot right away — the pool, share and queue recalculate around whoever's left. Their refund and any recovery are settled afterward, at your own pace, from the Open exits card.
            </p>
            <div className="bg-forest-50/70 rounded-lg p-3 text-xs flex flex-col gap-1">
              <div className="flex justify-between"><span>Contributed so far</span><span className="font-medium num">{kes(exitConfirmFor.contributed)}</span></div>
              <div className="flex justify-between"><span>Payouts already received</span><span className="font-medium num">{kes(exitConfirmFor.received)}</span></div>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-forest-800">
              Cut on refund
              <input
                type="number"
                min={0}
                max={100}
                value={exitCutInput}
                onChange={(e) => setExitCutInput(Number(e.target.value))}
                className="w-20 border border-forest-200 rounded-lg px-2 py-1.5 text-sm font-normal"
              />
              <span className="font-normal text-forest-900/45">% — refund is chased down from the Open exits card</span>
            </label>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setExitConfirmFor(null)} className="text-xs font-semibold px-3 py-1.5 rounded-full text-forest-900/60 hover:bg-forest-50">Cancel</button>
              <button onClick={confirmExit} disabled={busyKey === `exit-${exitConfirmFor.memberId}`} className="bg-brick-500 hover:bg-brick-600 text-white text-xs font-semibold px-4 py-1.5 rounded-full flex items-center gap-2">
                {busyKey === `exit-${exitConfirmFor.memberId}` && <Spinner />} Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettleArrearForm({ amount, busy, onCancel, onSubmit }: { amount: number; busy: boolean; onCancel: () => void; onSubmit: (amount: number) => void }) {
  const [value, setValue] = useState(amount);
  return (
    <span className="flex items-center gap-1">
      <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-20 border border-forest-200 rounded px-1 py-0.5 text-xs" />
      <button onClick={() => onSubmit(value)} disabled={busy} className="text-xs font-semibold text-forest-700 flex items-center gap-1">{busy && <Spinner className="spinner-dark" />} Save</button>
      <button onClick={onCancel} className="text-xs text-forest-900/40">Cancel</button>
    </span>
  );
}

function WriteOffForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <span className="flex items-center gap-1">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-28 border border-forest-200 rounded px-1 py-0.5 text-xs" />
      <button onClick={() => reason.trim() && onSubmit(reason.trim())} disabled={busy || !reason.trim()} className="text-xs font-semibold text-brick-500 flex items-center gap-1">{busy && <Spinner className="spinner-dark" />} Confirm</button>
      <button onClick={onCancel} className="text-xs text-forest-900/40">Cancel</button>
    </span>
  );
}
