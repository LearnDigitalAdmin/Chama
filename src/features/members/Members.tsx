import { useState } from 'react';
import { useChama } from '../../app/ChamaProvider';
import { useMembers } from '../../app/useMembers';
import { addAdmin, addMember } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes } from '../../lib/money';
import { isValidKenyanPhone } from '../../lib/phone';
import type { MemberRole } from '../../lib/types';

const STATUS_CHIP: Record<string, string> = {
  active: 'bg-forest-50 text-forest-700',
  inactive: 'bg-forest-50 text-forest-900/50',
  suspended: 'bg-brick-50 text-brick-500',
};

export default function Members() {
  const { chamaId, isFinanceAdmin } = useChama();
  const { members, ready } = useMembers(chamaId, false);
  const [showForm, setShowForm] = useState<null | 'member' | 'admin'>(null);

  if (!ready) return <p className="text-forest-900/60">Loading members…</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">Members ({members.length})</h1>
        {isFinanceAdmin && (
          <div className="flex gap-2">
            <button onClick={() => setShowForm('member')} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full">
              + Add member
            </button>
            <button
              onClick={() => setShowForm('admin')}
              className="border border-forest-200 hover:bg-forest-50 text-sm font-semibold px-4 py-2 rounded-full"
            >
              + Add admin
            </button>
          </div>
        )}
      </div>

      {showForm && <AddPersonForm kind={showForm} chamaId={chamaId!} onDone={() => setShowForm(null)} />}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-forest-900/50 text-xs border-b border-forest-100">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Total contributed</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-forest-50 last:border-0">
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3 text-forest-900/70">{m.phone}</td>
                <td className="px-4 py-3 capitalize">{m.role}</td>
                <td className="px-4 py-3">
                  <span className={`chip ${STATUS_CHIP[m.status]}`}>{m.status}</span>
                </td>
                <td className="px-4 py-3 num">{kes(m.totalContributed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddPersonForm({ kind, chamaId, onDone }: { kind: 'member' | 'admin'; chamaId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [role, setRole] = useState<Exclude<MemberRole, 'member'>>('secretary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim() || !isValidKenyanPhone(phone) || idNumber.trim().length < 4) {
      setError('Fill in a valid name, phone, and ID number.');
      return;
    }
    setBusy(true);
    try {
      if (kind === 'admin') {
        await addAdmin({ chamaId, name: name.trim(), phone, idNumber, role });
      } else {
        await addMember({ chamaId, name: name.trim(), phone, idNumber });
      }
      onDone();
    } catch (e) {
      const { message, isQueued } = describeCallError(e);
      if (isQueued) {
        setQueuedMsg(message);
        setTimeout(onDone, 1200);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 max-w-md flex flex-col gap-3">
      <h3 className="font-display font-semibold">{kind === 'admin' ? 'Add an admin' : 'Add a member'}</h3>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Full name
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Phone number
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        National ID number
        <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      {kind === 'admin' && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100">
            <option value="chair">Chair</option>
            <option value="treasurer">Treasurer</option>
            <option value="secretary">Secretary</option>
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button onClick={onDone} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
      {queuedMsg && <p className="text-sm text-gold-700 font-medium">{queuedMsg}</p>}
    </div>
  );
}
