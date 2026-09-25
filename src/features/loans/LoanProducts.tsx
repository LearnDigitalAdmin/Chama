/**
 * Loan products are a direct Firestore write, not a callable — see
 * firestore.rules' loanProducts section: create/update is open to any
 * finance admin, validated entirely by the rules themselves. Works
 * offline for free via Firestore's persistent local cache.
 */

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { slugify } from '../../lib/ids';
import { useChama } from '../../app/ChamaProvider';
import type { LoanProduct } from '../../lib/types';

export default function LoanProducts() {
  const { chamaId, isFinanceAdmin } = useChama();
  const [products, setProducts] = useState<LoanProduct[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!chamaId) return;
    return onSnapshot(collection(db, paths.loanProducts(chamaId)), (snap) => {
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LoanProduct));
    });
  }, [chamaId]);

  async function toggleActive(p: LoanProduct) {
    if (!chamaId) return;
    await updateDoc(doc(db, paths.loanProduct(chamaId, p.id)), { active: !p.active });
  }

  return (
    <div className="space-y-5">
      <Link to="/app/loans" className="text-sm font-semibold text-forest-700">
        &larr; Loans
      </Link>
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-semibold">Loan products</h1>
        {isFinanceAdmin && (
          <button onClick={() => setShowForm(true)} className="btn-add text-sm">
            + New product
          </button>
        )}
      </div>

      {showForm && chamaId && <ProductForm chamaId={chamaId} onDone={() => setShowForm(false)} />}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((p) => (
          <div key={p.id} className={`card p-5 ${p.active === false ? 'opacity-50' : ''}`}>
            <h3 className="font-display font-semibold">{p.name}</h3>
            <p className="text-sm text-forest-900/60 mt-1">
              {p.type === 'flat' ? `${p.rate}%/month (flat)` : `${p.rate}% p.a. (reducing balance)`}
            </p>
            <p className="text-sm text-forest-900/60">
              Up to KES {p.maxAmount.toLocaleString()} · {p.maxTerm} months max
            </p>
            {isFinanceAdmin && (
              <button className="text-sm font-semibold text-forest-700 mt-2" onClick={() => toggleActive(p)}>
                {p.active === false ? 'Reactivate' : 'Deactivate'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductForm({ chamaId, onDone }: { chamaId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'flat' | 'reducing'>('flat');
  const [rate, setRate] = useState('5');
  const [maxAmount, setMaxAmount] = useState('50000');
  const [maxTerm, setMaxTerm] = useState('6');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const rateNum = Number(rate);
    const maxAmountNum = Number(maxAmount);
    const maxTermNum = Number(maxTerm);
    if (!name.trim() || rateNum < 0 || rateNum > 100 || maxAmountNum <= 0 || maxTermNum < 1 || maxTermNum > 60) {
      setError('Check the values — rate 0-100, term 1-60 months, amount > 0.');
      return;
    }
    setBusy(true);
    try {
      const id = slugify(name) + '_' + Date.now().toString(36).slice(-4);
      await setDoc(doc(db, paths.loanProduct(chamaId, id)), {
        name: name.trim(),
        type,
        rate: rateNum,
        maxAmount: maxAmountNum,
        maxTerm: maxTermNum,
        desc: '',
        active: true,
      });
      onDone();
    } catch {
      setError('Could not save — check you have permission to manage loan products.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 max-w-md flex flex-col gap-3">
      <h3 className="font-display font-semibold">New loan product</h3>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Interest method
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
          <option value="flat">Flat rate (per month, on original amount)</option>
          <option value="reducing">Reducing balance (per annum, on outstanding amount)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Rate (%)
        <input type="number" step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Max amount (KES)
        <input type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Max term (months)
        <input type="number" value={maxTerm} onChange={(e) => setMaxTerm(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
          {busy ? 'Saving…' : 'Save product'}
        </button>
        <button onClick={onDone} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
    </div>
  );
}
