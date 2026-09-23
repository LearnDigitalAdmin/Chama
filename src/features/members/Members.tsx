import { useMemo, useState } from 'react';
import { useChama } from '../../app/ChamaProvider';
import { useMembers } from '../../app/useMembers';
import { addAdmin, addMember, updateMember } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { kes } from '../../lib/money';
import { isValidKenyanPhone } from '../../lib/phone';
import type { ChamaMember, MemberRole } from '../../lib/types';

const STATUS_CHIP: Record<string, string> = {
  active: 'bg-forest-50 text-forest-700',
  inactive: 'bg-forest-50 text-forest-900/50',
  suspended: 'bg-brick-50 text-brick-500',
};

const ASSIGNABLE_ROLES: Exclude<MemberRole, 'chair'>[] = ['treasurer', 'secretary', 'member'];
const STATUSES: ChamaMember['status'][] = ['active', 'inactive', 'suspended'];

export default function Members() {
  const { chamaId, isFinanceAdmin } = useChama();
  const { members, ready } = useMembers(chamaId, false);
  const [showForm, setShowForm] = useState<null | 'member' | 'admin'>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ChamaMember | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q) || m.phone.toLowerCase().includes(q));
  }, [members, query]);

  // Keep the open detail panel in sync with live member updates (e.g. after
  // an edit/role/status change commits) rather than holding a stale copy.
  const selectedLive = selected ? (members.find((m) => m.id === selected.id) ?? null) : null;

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

      <div className="relative max-w-sm">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members…"
          className="w-full border border-forest-200 rounded-full pl-4 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest-300"
        />
      </div>

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
            {filtered.map((m) => (
              <tr
                key={m.id}
                onClick={() => setSelected(m)}
                className="border-b border-forest-50 last:border-0 cursor-pointer hover:bg-forest-50/60"
              >
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3 text-forest-900/70">{m.phone}</td>
                <td className="px-4 py-3 capitalize">{m.role}</td>
                <td className="px-4 py-3">
                  <span className={`chip ${STATUS_CHIP[m.status]}`}>{m.status}</span>
                </td>
                <td className="px-4 py-3 num">{kes(m.totalContributed)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-forest-900/50">
                  No members match "{query}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedLive && chamaId && (
        <MemberDetailModal
          member={selectedLive}
          chamaId={chamaId}
          canManage={isFinanceAdmin}
          onClose={() => setSelected(null)}
        />
      )}
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
      <p className="text-xs text-forest-900/50">
        {kind === 'admin' ? 'They' : 'This member'} will show up here right away. No link is sent — when they sign in
        with this exact phone number, they're matched to this record and dropped straight into the chama automatically.
      </p>
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

function MemberDetailModal({
  member,
  chamaId,
  canManage,
  onClose,
}: {
  member: ChamaMember;
  chamaId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'role'>('view');
  const [showId, setShowId] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);

  const isChair = member.role === 'chair';

  async function patch(update: Partial<{ name: string; phone: string; role: MemberRole; status: ChamaMember['status'] }>) {
    setError(null);
    setBusy(true);
    try {
      await updateMember({ chamaId, memberId: member.id, patch: update });
      setQueuedMsg(null);
      setMode('view');
    } catch (e) {
      const { message, isQueued } = describeCallError(e);
      if (isQueued) {
        setQueuedMsg(message);
        setMode('view');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="card p-5 max-w-sm w-full flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        {mode === 'view' && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display font-semibold text-lg">{member.name}</h3>
                <p className="text-sm text-forest-900/60">{member.phone}</p>
              </div>
              <span className={`chip ${STATUS_CHIP[member.status]} capitalize`}>{member.status}</span>
            </div>

            <dl className="text-sm grid grid-cols-2 gap-y-2">
              <dt className="text-forest-900/50">Role</dt>
              <dd className="capitalize">{member.role}</dd>
              <dt className="text-forest-900/50">Joined</dt>
              <dd>{member.joinDate}</dd>
              <dt className="text-forest-900/50">Total contributed</dt>
              <dd className="num">{kes(member.totalContributed)}</dd>
              <dt className="text-forest-900/50">Credit balance</dt>
              <dd className="num">{kes(member.creditBalance)}</dd>
              <dt className="text-forest-900/50">National ID</dt>
              <dd>
                {showId ? (member.idNumber ?? member.nationalIdMasked) : member.nationalIdMasked}{' '}
                <button onClick={() => setShowId((v) => !v)} className="text-forest-700 font-semibold text-xs ml-1">
                  {showId ? 'Hide' : 'Show'}
                </button>
              </dd>
              <dt className="text-forest-900/50">Account</dt>
              <dd>{member.uid ? 'Linked — can log in' : 'Not linked — awaiting first sign-in'}</dd>
            </dl>

            {canManage && (
              <div className="flex flex-col gap-2 pt-2 border-t border-forest-100">
                <button onClick={() => setMode('edit')} disabled={busy} className="text-sm font-semibold text-forest-700 text-left">
                  Edit details
                </button>
                {!isChair && (
                  <button onClick={() => setMode('role')} disabled={busy} className="text-sm font-semibold text-forest-700 text-left">
                    Change role
                  </button>
                )}
                <div className="flex gap-2 flex-wrap pt-1">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      disabled={busy || member.status === s}
                      onClick={() => patch({ status: s })}
                      className={`chip capitalize ${member.status === s ? STATUS_CHIP[s] : 'border border-forest-200 text-forest-700'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {mode === 'edit' && <EditMemberFields member={member} busy={busy} onCancel={() => setMode('view')} onSave={patch} />}

        {mode === 'role' && (
          <>
            <h3 className="font-display font-semibold">Change role</h3>
            <div className="flex flex-col gap-2">
              {ASSIGNABLE_ROLES.map((r) => (
                <button
                  key={r}
                  disabled={busy || member.role === r}
                  onClick={() => patch({ role: r })}
                  className={`text-sm font-semibold text-left px-3 py-2 rounded-lg border capitalize ${
                    member.role === r ? 'border-forest-700 bg-forest-50' : 'border-forest-100 hover:bg-forest-50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <button onClick={() => setMode('view')} disabled={busy} className="text-sm font-semibold text-forest-700 self-start">
              Back
            </button>
          </>
        )}

        {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
        {queuedMsg && <p className="text-sm text-gold-700 font-medium">{queuedMsg}</p>}

        {mode === 'view' && (
          <button onClick={onClose} className="text-sm font-semibold text-forest-900/50 self-center pt-1">
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function EditMemberFields({
  member,
  busy,
  onCancel,
  onSave,
}: {
  member: ChamaMember;
  busy: boolean;
  onCancel: () => void;
  onSave: (update: { name: string; phone: string }) => void;
}) {
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(member.phone);
  const [localError, setLocalError] = useState<string | null>(null);

  function submit() {
    setLocalError(null);
    if (!name.trim()) {
      setLocalError('Name is required.');
      return;
    }
    if (!isValidKenyanPhone(phone)) {
      setLocalError('Enter a valid Kenyan phone number.');
      return;
    }
    onSave({ name: name.trim(), phone });
  }

  return (
    <>
      <h3 className="font-display font-semibold">Edit details</h3>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Full name
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Phone number
        <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
        <span className="text-xs text-forest-900/50 font-normal">
          Changing this changes which sign-in matches this member — including WhatsApp bot access.
        </span>
      </label>
      {localError && <p className="text-sm text-brick-500 font-medium">{localError}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
          Cancel
        </button>
      </div>
    </>
  );
}
