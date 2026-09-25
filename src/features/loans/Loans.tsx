/**
 * Loan APPLICATION and APPROVAL below are direct Firestore writes, per
 * firestore.rules — see functions/mychama/loans.py's module docstring.
 * They work offline for free via Firestore's persistent local cache.
 * Approval writes touch ONLY the one approver's boolean, via a dot-path
 * update, never the whole `approvals` map — status is derived server-side
 * by on_loan_write, never computed here. Disbursement and repayment call
 * the server (offline-queued) because rules block clients from ever
 * setting status:'active' or touching schedule[].paidAmount directly.
 */

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers, memberName } from '../../app/useMembers';
import { buildSchedule, loanOutstanding, loanStatusLabel, nextUnpaidInstallment } from '../../lib/loanSchedule';
import { kes } from '../../lib/money';
import { todayISO } from '../../lib/dates';
import { disburseLoanCash, recordCashLoanRepayment } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import type { Loan, LoanProduct } from '../../lib/types';
import MyLoans from './MyLoans';

const STATUS_CHIP: Record<string, string> = {
  pending_approval: 'bg-gold-50 text-gold-700',
  awaiting_treasurer: 'bg-gold-50 text-gold-700',
  approved: 'bg-forest-50 text-forest-700',
  active: 'bg-forest-50 text-forest-700',
  overdue: 'bg-brick-50 text-brick-500',
  completed: 'bg-forest-50 text-forest-900/50',
  rejected: 'bg-brick-50 text-brick-500',
};

export default function Loans() {
  const { chamaId, membership, isFinanceAdmin } = useChama();
  if (membership?.role === 'member') return <MyLoans />;
  return <AdminLoans chamaId={chamaId} membership={membership} isFinanceAdmin={isFinanceAdmin} />;
}

function AdminLoans({ chamaId, membership, isFinanceAdmin }: { chamaId: string | null; membership: ReturnType<typeof useChama>['membership']; isFinanceAdmin: boolean }) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [products, setProducts] = useState<Record<string, LoanProduct>>({});
  const { members } = useMembers(chamaId, false);
  const [showApply, setShowApply] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (loans.find((l) => l.id === selectedId) ?? null) : null;

  useEffect(() => {
    if (!chamaId) return;
    const unsub1 = onSnapshot(collection(db, paths.loans(chamaId)), (snap) => {
      setLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Loan));
    });
    const unsub2 = onSnapshot(collection(db, paths.loanProducts(chamaId)), (snap) => {
      const map: Record<string, LoanProduct> = {};
      snap.docs.forEach((d) => (map[d.id] = { id: d.id, ...d.data() } as LoanProduct));
      setProducts(map);
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, [chamaId]);

  if (selected) {
    return (
      <LoanDetail
        loan={selected}
        product={products[selected.productId]}
        chamaId={chamaId!}
        membership={membership}
        isFinanceAdmin={isFinanceAdmin}
        memberLabel={memberName(members, selected.memberId)}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-semibold">Loans</h1>
        <div className="flex gap-2">
          {isFinanceAdmin && (
            <Link to="/app/loan-products" className="btn-ghost text-sm">
              Loan products
            </Link>
          )}
          <button onClick={() => setShowApply(true)} className="btn-add text-sm">
            + Apply for a loan
          </button>
        </div>
      </div>

      {showApply && chamaId && membership && (
        <ApplyLoanForm
          chamaId={chamaId}
          memberId={membership.memberId}
          products={Object.values(products).filter((p) => p.active !== false)}
          onDone={() => setShowApply(false)}
        />
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-forest-900/50 text-xs border-b border-forest-100">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Principal</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => (
              <tr key={l.id} className="border-b border-forest-50 last:border-0 cursor-pointer hover:bg-forest-50/40" onClick={() => setSelectedId(l.id)}>
                <td className="px-4 py-3 font-medium">{memberName(members, l.memberId)}</td>
                <td className="px-4 py-3 text-forest-900/70">{products[l.productId]?.name ?? '—'}</td>
                <td className="px-4 py-3 num">{kes(l.principal)}</td>
                <td className="px-4 py-3">
                  <span className={`chip ${STATUS_CHIP[l.status]}`}>{loanStatusLabel(l)}</span>
                </td>
                <td className="px-4 py-3 num">{l.status === 'completed' ? 'Paid off' : kes(loanOutstanding(l))}</td>
              </tr>
            ))}
            {!loans.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-forest-900/50">
                  No loans yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ApplyLoanForm({
  chamaId,
  memberId,
  products,
  onDone,
}: {
  chamaId: string;
  memberId: string;
  products: LoanProduct[];
  onDone: () => void;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [amount, setAmount] = useState('20000');
  const [term, setTerm] = useState('3');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = products.find((p) => p.id === productId);
  const capped = product ? Math.min(Number(amount) || 0, product.maxAmount) : 0;
  const cappedTerm = product ? Math.min(Number(term) || 1, product.maxTerm) : 1;
  const preview = product ? buildSchedule(product, capped, cappedTerm) : null;

  async function submit() {
    setError(null);
    if (!product) {
      setError('Choose a loan product.');
      return;
    }
    setBusy(true);
    try {
      const calc = buildSchedule(product, capped, cappedTerm);
      const loanRef = doc(collection(db, paths.loans(chamaId)));
      await setDoc(loanRef, {
        memberId,
        productId: product.id,
        principal: capped,
        term: cappedTerm,
        purpose: purpose.trim() || null,
        status: 'pending_approval',
        approvals: { chair: false, treasurer: false },
        requestedOn: todayISO(),
        disbursedOn: null,
        method: null,
        installment: calc.installment,
        totalInterest: calc.totalInterest,
        totalPay: calc.totalPay,
        schedule: calc.schedule,
        source: 'app',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      onDone();
    } catch {
      setError('Could not submit the application — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 max-w-md flex flex-col gap-3">
      <h3 className="font-display font-semibold">Apply for a loan</h3>
      {!products.length && <p className="text-sm text-forest-900/60">No active loan products yet — ask a finance admin to add one.</p>}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Loan product
        <select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Amount (KES)
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Term (months)
        <input type="number" value={term} onChange={(e) => setTerm(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Purpose (optional)
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      {preview && (
        <p className="text-sm text-forest-900/70">
          Estimated installment: <b className="text-ink">{kes(preview.installment)}</b>/month · Total interest:{' '}
          <b className="text-ink">{kes(preview.totalInterest)}</b>
        </p>
      )}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || !product} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
          {busy ? 'Submitting…' : 'Submit application'}
        </button>
        <button onClick={onDone} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
    </div>
  );
}

function LoanDetail({
  loan,
  product,
  chamaId,
  membership,
  isFinanceAdmin,
  memberLabel,
  onBack,
}: {
  loan: Loan;
  product?: LoanProduct;
  chamaId: string;
  membership: { role: string; memberId: string } | null;
  isFinanceAdmin: boolean;
  memberLabel: string;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState('');

  const alreadyApproved =
    (membership?.role === 'chair' && loan.approvals.chair) || (membership?.role === 'treasurer' && loan.approvals.treasurer);

  async function approve(decision: 'approve' | 'reject') {
    setError(null);
    setBusy(true);
    try {
      const loanRef = doc(db, paths.loan(chamaId, loan.id));
      if (decision === 'reject') {
        await updateDoc(loanRef, { status: 'rejected', updatedAt: Date.now() });
      } else if (membership?.role === 'chair') {
        // Dot-path: touches ONLY approvals.chair. Never spread the whole
        // approvals map here — that's what let a stale local read
        // overwrite the treasurer's already-committed flag (see
        // functions/mychama/loans.py's module docstring for the incident
        // this fixes). Status is not written here at all — on_loan_write
        // derives it from approvals server-side.
        await updateDoc(loanRef, { 'approvals.chair': true, updatedAt: Date.now() });
      } else if (membership?.role === 'treasurer') {
        await updateDoc(loanRef, { 'approvals.treasurer': true, updatedAt: Date.now() });
      }
    } catch {
      setError('Could not record the approval.');
    } finally {
      setBusy(false);
    }
  }

  async function disburse() {
    setBusy(true);
    setError(null);
    try {
      await disburseLoanCash({ chamaId, loanId: loan.id });
    } catch (e) {
      const { message, isQueued } = describeCallError(e);
      isQueued ? setQueuedMsg(message) : setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function repay() {
    const amount = Number(repayAmount);
    if (!(amount > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordCashLoanRepayment({ chamaId, loanId: loan.id, amount });
      setRepayAmount('');
    } catch (e) {
      const { message, isQueued } = describeCallError(e);
      isQueued ? setQueuedMsg(message) : setError(message);
    } finally {
      setBusy(false);
    }
  }

  const nextDue = nextUnpaidInstallment(loan);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm font-semibold text-forest-700">
        &larr; All loans
      </button>
      <div className="page-header">
        <h1 className="font-display text-2xl font-semibold">{memberLabel}</h1>
        <p className="text-sm text-white/70 mt-1">
          {product?.name} · {kes(loan.principal)} · {loan.term} months ·{' '}
          <span className={`chip ${STATUS_CHIP[loan.status]}`}>{loanStatusLabel(loan)}</span>
        </p>
      </div>

      {(loan.status === 'pending_approval' || loan.status === 'awaiting_treasurer') &&
        (membership?.role === 'chair' || membership?.role === 'treasurer') && (
          <div className="card p-4">
            {alreadyApproved ? (
              <p className="text-sm text-forest-900/60">You've already approved this application.</p>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => approve('approve')} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full">
                  Approve as {membership?.role}
                </button>
                <button onClick={() => approve('reject')} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
                  Reject
                </button>
              </div>
            )}
          </div>
        )}

      {loan.status === 'approved' && isFinanceAdmin && (
        <button onClick={disburse} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full">
          {busy ? 'Disbursing…' : 'Disburse (cash)'}
        </button>
      )}

      {(loan.status === 'active' || loan.status === 'overdue') && nextDue && isFinanceAdmin && (
        <div className="card p-4 max-w-sm flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Record cash repayment (balance due {kes(nextDue.due - nextDue.paidAmount)})
            <input type="number" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
          </label>
          <button onClick={repay} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full self-start">
            {busy ? 'Recording…' : 'Record received'}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
      {queuedMsg && <p className="text-sm text-gold-700 font-medium">{queuedMsg}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-forest-900/50 text-xs border-b border-forest-100">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Due date</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loan.schedule.map((s) => (
              <tr key={s.n} className="border-b border-forest-50 last:border-0">
                <td className="px-4 py-3">{s.n}</td>
                <td className="px-4 py-3">{s.dueDate}</td>
                <td className="px-4 py-3 num">{kes(s.due)}</td>
                <td className="px-4 py-3">{s.paid ? 'Paid' : s.paidAmount > 0 ? 'Partial' : 'Due'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
