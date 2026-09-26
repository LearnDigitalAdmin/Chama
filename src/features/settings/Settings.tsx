import { useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers } from '../../app/useMembers';
import Profile from '../profile/Profile';
import { PLANS } from '../../lib/constants';

export default function Settings() {
  const { membership } = useChama();
  return membership?.role === 'member' ? <Profile /> : <AdminSettings />;
}

function AdminSettings() {
  const { chama, chamaId, chamaReady, isFinanceAdmin, isTreasurer } = useChama();
  const { members } = useMembers(chamaId, true);
  const admins = members.filter((m) => m.isAdmin);
  const [name, setName] = useState('');
  const [motto, setMotto] = useState('');
  const [contributionAmount, setContributionAmount] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!chamaReady || !chama || !chamaId) return <p className="text-forest-900/60">Loading…</p>;

  function startEdit() {
    setName(chama!.name);
    setMotto(chama!.motto ?? '');
    setContributionAmount(String(chama!.contributionAmount));
    setOpeningBalance(String(chama!.openingBalance ?? 0));
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Two writes, not one: firestore.rules gates the balance separately
      // from the rest of the chama profile (treasurer-only vs. any finance
      // admin), so a single combined update would be rejected whenever a
      // non-treasurer chair edits the profile alongside it.
      await updateDoc(doc(db, paths.chama(chamaId!)), {
        name: name.trim(),
        motto: motto.trim() || null,
        contributionAmount: Number(contributionAmount),
        updatedAt: Date.now(),
      });
      if (isTreasurer) {
        const newBalance = Number(openingBalance);
        if (newBalance !== (chama!.openingBalance ?? 0)) {
          await updateDoc(doc(db, paths.chama(chamaId!)), {
            openingBalance: newBalance,
            updatedAt: Date.now(),
          });
        }
      }
      setEditing(false);
    } catch {
      setError("Couldn't save — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const canManage = isFinanceAdmin;

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="page-header">
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <p className="font-display font-semibold">Chama profile</p>
          {canManage && !editing && (
            <button onClick={startEdit} className="text-sm font-semibold text-forest-700">
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Motto
              <input value={motto} onChange={(e) => setMotto(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Contribution amount (KES / {chama.contributionCycle})
              <input type="number" value={contributionAmount} onChange={(e) => setContributionAmount(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
            </label>
            {isTreasurer ? (
              <label className="flex flex-col gap-1 text-sm font-medium">
                Opening balance (KES)
                <input type="number" min={0} value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
                <span className="text-xs font-normal text-forest-900/50">Only the treasurer can update this. Feeds directly into the Group balance on the dashboard.</span>
              </label>
            ) : (
              <p className="text-xs text-forest-900/50">Opening balance (KES {chama.openingBalance?.toLocaleString('en-KE') ?? 0}) can only be updated by the treasurer.</p>
            )}
            <div className="flex gap-2">
              <button onClick={save} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
                Cancel
              </button>
            </div>
            {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-forest-900/50">Name:</span> {chama.name}
            </p>
            {chama.motto && (
              <p>
                <span className="text-forest-900/50">Motto:</span> {chama.motto}
              </p>
            )}
            <p>
              <span className="text-forest-900/50">Contribution:</span> KES {chama.contributionAmount.toLocaleString('en-KE')} / {chama.contributionCycle}
            </p>
            <p>
              <span className="text-forest-900/50">Opening balance:</span> KES {(chama.openingBalance ?? 0).toLocaleString('en-KE')}
            </p>
            <p>
              <span className="text-forest-900/50">Plan:</span> {PLANS[chama.plan].name}
            </p>
          </div>
        )}
      </div>

      <div className="card p-6">
        <p className="font-display font-semibold mb-3">Admins</p>
        <div className="space-y-2">
          {admins.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0" style={{ backgroundColor: m.avatarColor || '#1F4D3A' }}>
                {m.initial ?? m.name.charAt(0)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-forest-900/45">{m.phone}</p>
              </div>
              <span className="chip bg-forest-50 text-forest-700 capitalize">{m.role}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <p className="font-display font-semibold mb-3">More settings</p>
        <div className="flex flex-col gap-2">
          <Link to="/app/billing" className="text-sm font-semibold text-forest-700 hover:underline">
            Plan & billing →
          </Link>
          <Link to="/app/loan-products" className="text-sm font-semibold text-forest-700 hover:underline">
            Loan products →
          </Link>
          <Link to="/app/payments" className="text-sm font-semibold text-forest-700 hover:underline">
            Settlement account →
          </Link>
          <Link to="/app/members" className="text-sm font-semibold text-forest-700 hover:underline">
            Members →
          </Link>
        </div>
      </div>
    </div>
  );
}
