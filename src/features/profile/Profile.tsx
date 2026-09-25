import { useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { kes } from '../../lib/money';
import { fmtDate } from '../../lib/dates';
import type { ChamaMember } from '../../lib/types';

const ROLE_LABEL: Record<string, string> = { chair: 'Chair', treasurer: 'Treasurer', secretary: 'Secretary', member: 'Member' };

export default function Profile() {
  const { chama, chamaId, chamaReady, membership } = useChama();
  const [me, setMe] = useState<ChamaMember | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const memberId = membership?.memberId;

  useEffect(() => {
    if (!chamaId || !memberId) return;
    return onSnapshot(doc(db, paths.member(chamaId, memberId)), (s) => setMe(s.exists() ? ({ id: s.id, ...s.data() } as ChamaMember) : null));
  }, [chamaId, memberId]);

  async function leave() {
    if (!chamaId || !memberId) return;
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, paths.member(chamaId, memberId)), { status: 'inactive', updatedAt: Date.now() });
      setConfirmLeave(false);
    } catch {
      setError("Couldn't update your membership — please try again, or ask an admin.");
    } finally {
      setBusy(false);
    }
  }

  if (!chamaReady || !chama || !me) return <p className="text-forest-900/60">Loading…</p>;

  return (
    <div className="space-y-4 max-w-lg">
      <div className="page-header">
        <h1 className="font-display text-2xl font-semibold">My profile</h1>
      </div>

      <div className="card p-6 flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center font-display text-xl font-semibold text-white shrink-0"
          style={{ backgroundColor: me.avatarColor || '#1F4D3A' }}
        >
          {me.initial ?? me.name.charAt(0)}
        </div>
        <div>
          <p className="font-display text-lg font-semibold">{me.name}</p>
          <p className="text-sm text-forest-900/50">{me.phone}</p>
          <span className="chip bg-forest-50 text-forest-700 mt-1 inline-block">{ROLE_LABEL[me.role]}</span>
        </div>
      </div>

      <div className="card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-forest-900/50">Member since</span>
          <span className="text-sm font-medium">{fmtDate(me.joinDate)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-forest-900/50">ID number</span>
          <span className="text-sm font-medium">{me.nationalIdMasked}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-forest-900/50">Total contributed</span>
          <span className="text-sm font-medium">{kes(me.totalContributed)}</span>
        </div>
        {me.creditBalance > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-forest-900/50">Credit balance</span>
            <span className="text-sm font-medium">{kes(me.creditBalance)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm text-forest-900/50">Status</span>
          <span className={`chip ${me.status === 'active' ? 'bg-forest-50 text-forest-700' : 'bg-brick-50 text-brick-500'}`}>{me.status}</span>
        </div>
      </div>

      {me.status === 'active' && (
        <div className="card p-5">
          {confirmLeave ? (
            <div className="space-y-2">
              <p className="text-sm text-ink">
                Leaving marks you inactive in {chama.name} — you'll keep your contribution history, but an admin will need to reactivate you if you come back.
              </p>
              <div className="flex gap-2">
                <button onClick={leave} disabled={busy} className="bg-brick-500 hover:bg-brick-600 text-white text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
                  {busy ? 'Leaving…' : 'Yes, leave this chama'}
                </button>
                <button onClick={() => setConfirmLeave(false)} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
                  Cancel
                </button>
              </div>
              {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
            </div>
          ) : (
            <button onClick={() => setConfirmLeave(true)} className="text-sm font-semibold text-brick-500">
              Leave this chama
            </button>
          )}
        </div>
      )}

      <button onClick={() => signOut(auth)} className="text-sm font-semibold text-forest-900/50 hover:text-forest-900">
        Sign out
      </button>
    </div>
  );
}
