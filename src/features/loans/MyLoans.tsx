import { useEffect, useState } from 'react';
import { collection, onSnapshot, where, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { initiatePayment } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes, loanRepaymentFees } from '../../lib/money';
import { loanOutstanding, loanStatusLabel, nextUnpaidInstallment } from '../../lib/loanSchedule';
import { PLANS } from '../../lib/constants';
import { ApplyLoanForm } from './Loans';
import type { Loan, LoanProduct } from '../../lib/types';

const STATUS_CHIP: Record<string, string> = {
  pending_approval: 'bg-gold-50 text-gold-700',
  awaiting_treasurer: 'bg-gold-50 text-gold-700',
  approved: 'bg-forest-50 text-forest-700',
  active: 'bg-forest-50 text-forest-700',
  overdue: 'bg-brick-50 text-brick-500',
  completed: 'bg-forest-50 text-forest-900/50',
  rejected: 'bg-brick-50 text-brick-500',
};
const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Awaiting chair approval',
  awaiting_treasurer: 'Awaiting treasurer approval',
  approved: 'Approved — awaiting disbursement',
  active: 'Active',
  overdue: 'Overdue',
  completed: 'Completed',
  rejected: 'Rejected',
};

// pending_approval and awaiting_treasurer are stored generically ("one
// approver has gone, one hasn't") — the fixed map above only ever labels
// them as if chair goes first and treasurer is always the one still
// pending, which is wrong whenever the treasurer actually approved first.
// This derives the honest label from `approvals` for those two statuses
// and falls back to the fixed map for everything else.
function pendingLoanLabel(loan: Loan): string {
  if (loan.status !== 'pending_approval' && loan.status !== 'awaiting_treasurer') {
    return STATUS_LABEL[loan.status];
  }
  const label = loanStatusLabel(loan);
  return label.charAt(0).toUpperCase() + label.slice(1) + ' approval';
}

export default function MyLoans() {
  const { chama, chamaId, chamaReady, membership } = useChama();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [products, setProducts] = useState<Record<string, LoanProduct>>({});
  const [showApply, setShowApply] = useState(false);
  const [payTarget, setPayTarget] = useState<Loan | null>(null);
  const memberId = membership?.memberId;

  useEffect(() => {
    if (!chamaId || !memberId) return;
    const unsubs = [
      onSnapshot(query(collection(db, paths.loans(chamaId)), where('memberId', '==', memberId)), (s) =>
        setLoans(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Loan))
      ),
      onSnapshot(collection(db, paths.loanProducts(chamaId)), (s) => {
        const map: Record<string, LoanProduct> = {};
        s.docs.forEach((d) => (map[d.id] = { id: d.id, ...d.data() } as LoanProduct));
        setProducts(map);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [chamaId, memberId]);

  if (!chamaReady || !chama || !memberId) return <p className="text-forest-900/60">Loading…</p>;

  const onlineCollection = PLANS[chama.plan].onlineCollection;
  const activeProducts = Object.values(products).filter((p) => p.active);
  const openLoan = loans.find((l) => l.status === 'active' || l.status === 'overdue');
  const pendingLoan = loans.find((l) => ['pending_approval', 'awaiting_treasurer', 'approved'].includes(l.status));
  const history = loans.filter((l) => l.status === 'completed' || l.status === 'rejected').sort((a, b) => b.requestedOn.localeCompare(a.requestedOn));

  return (
    <div className="space-y-5">
      {openLoan ? (
        <div className="card p-6">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs font-semibold text-forest-900/50">{products[openLoan.productId]?.name ?? 'Loan'}</p>
              <p className="font-display text-2xl font-semibold mt-1">{kes(loanOutstanding(openLoan))} outstanding</p>
              <span className={`chip mt-2 inline-block ${STATUS_CHIP[openLoan.status]}`}>{STATUS_LABEL[openLoan.status]}</span>
            </div>
            {onlineCollection && (
              <button onClick={() => setPayTarget(openLoan)} className="btn-primary text-sm font-semibold px-4 py-2.5 rounded-full">
                Repay now
              </button>
            )}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-forest-900/45 border-b border-forest-100">
                  <th className="py-2 font-semibold">#</th>
                  <th className="py-2 font-semibold">Due date</th>
                  <th className="py-2 font-semibold">Amount</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {openLoan.schedule.map((s) => (
                  <tr key={s.n} className="border-b border-forest-50 last:border-0">
                    <td className="py-2">{s.n}</td>
                    <td className="py-2">{s.dueDate}</td>
                    <td className="py-2 num">{kes(s.due)}</td>
                    <td className="py-2">{s.paid ? <span className="chip bg-forest-50 text-forest-700">Paid</span> : <span className="chip bg-forest-50 text-forest-900/45">Due</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : pendingLoan ? (
        <div className="card p-6">
          <p className="text-xs font-semibold text-forest-900/50">{products[pendingLoan.productId]?.name ?? 'Loan'}</p>
          <p className="font-display text-2xl font-semibold mt-1">{kes(pendingLoan.principal)} requested</p>
          <span className={`chip mt-2 inline-block ${STATUS_CHIP[pendingLoan.status]}`}>{pendingLoanLabel(pendingLoan)}</span>
        </div>
      ) : (
        <div className="card p-6 text-center">
          <p className="font-display text-lg font-semibold">No active loan</p>
          <p className="text-sm text-forest-900/50 mt-1">Apply below when you need one.</p>
        </div>
      )}

      {!openLoan && !pendingLoan && (
        <>
          {showApply ? (
            <ApplyLoanForm chamaId={chamaId!} memberId={memberId} products={activeProducts} onDone={() => setShowApply(false)} />
          ) : (
            <button onClick={() => setShowApply(true)} disabled={!activeProducts.length} className="btn-primary text-sm font-semibold px-5 py-2.5 rounded-full disabled:opacity-50">
              Apply for a loan
            </button>
          )}
          {!activeProducts.length && <p className="text-xs text-forest-900/50">No loan products are set up yet — ask a finance admin.</p>}
        </>
      )}

      {history.length > 0 && (
        <div className="card p-5">
          <h3 className="font-display font-semibold mb-3">Loan history</h3>
          <ul className="divide-y divide-forest-50">
            {history.map((l) => (
              <li key={l.id} className="py-2.5 text-sm flex items-center justify-between">
                <span>
                  {products[l.productId]?.name ?? 'Loan'} · {kes(l.principal)}
                </span>
                <span className={`chip ${STATUS_CHIP[l.status]}`}>{STATUS_LABEL[l.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {payTarget && chamaId && <RepayForm chamaId={chamaId} loan={payTarget} plan={chama.plan} onClose={() => setPayTarget(null)} />}
    </div>
  );
}

function RepayForm({ chamaId, loan, plan, onClose }: { chamaId: string; loan: Loan; plan: Parameters<typeof loanRepaymentFees>[1]; onClose: () => void }) {
  const nextDue = nextUnpaidInstallment(loan);
  const [amount, setAmount] = useState(String(nextDue?.due ?? Math.round(loanOutstanding(loan))));
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const net = Number(amount) || 0;
  const fees = net > 0 ? loanRepaymentFees(net, plan) : null;

  async function submit() {
    setError(null);
    if (!(net > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      await initiatePayment({ chamaId, purpose: 'loan_repayment', amount: net, phone, loanId: loan.id });
      setStarted(true);
    } catch (e) {
      setError(describeCallError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="card p-5 max-w-sm w-full flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-semibold">Repay loan</h3>
        {started ? (
          <>
            <p className="text-sm text-forest-700">Check your phone for the M-Pesa/Airtel Money prompt to complete the payment.</p>
            <button onClick={onClose} className="text-sm font-semibold text-forest-700 self-start">
              Done
            </button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Amount (KES)
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              M-Pesa/Airtel number
              <input type="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
            </label>
            {fees && (
              <p className="text-xs text-forest-900/50">
                Loan is credited {kes(fees.net)} · you'll be charged {kes(fees.gross)} (covers the {kes(fees.paystackFee + fees.ourFee)} transaction fee).
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
                {busy ? 'Starting…' : 'Pay'}
              </button>
              <button onClick={onClose} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
                Cancel
              </button>
            </div>
            {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
