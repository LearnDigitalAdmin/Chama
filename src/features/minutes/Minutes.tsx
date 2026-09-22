/**
 * Minutes are entirely direct Firestore writes — firestore.rules lets the
 * secretary or chair create/update, and only the chair delete. Works
 * offline for free via Firestore's persistent local cache.
 */

import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { todayISO } from '../../lib/dates';
import { generateStatement } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { PLANS } from '../../lib/constants';
import type { Minute } from '../../lib/types';

export default function Minutes() {
  const { chama, chamaId, membership } = useChama();
  const [minutes, setMinutes] = useState<Minute[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!chamaId) return;
    return onSnapshot(collection(db, paths.minutes(chamaId)), (snap) => {
      setMinutes(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Minute)
          .sort((a, b) => (a.date < b.date ? 1 : -1))
      );
    });
  }, [chamaId]);

  async function remove(id: string) {
    if (!chamaId || membership?.role !== 'chair') return;
    await deleteDoc(doc(db, `${paths.minutes(chamaId)}/${id}`));
  }

  async function exportPdf(id: string) {
    if (!chamaId) return;
    setExportingId(id);
    setExportError(null);
    try {
      const res = await generateStatement({ chamaId, minutesId: id, format: 'pdf' });
      window.open(res.url, '_blank');
    } catch (e) {
      setExportError(describeCallError(e).message);
    } finally {
      setExportingId(null);
    }
  }

  const canWrite = membership?.role === 'chair' || membership?.role === 'secretary';
  const exportsAllowed = chama ? PLANS[chama.plan].exportsAllowed : false;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">Minutes</h1>
        {canWrite && (
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full">
            + Record minutes
          </button>
        )}
      </div>

      {showForm && chamaId && canWrite && (
        <MinutesForm chamaId={chamaId} recordedBy={membership!.memberId} onDone={() => setShowForm(false)} />
      )}

      <div className="space-y-4">
        {minutes.map((m) => (
          <div key={m.id} className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold">{m.title}</h3>
              <span className="text-xs text-forest-900/50">{m.date}</span>
            </div>
            {m.venue && <p className="text-sm text-forest-900/60 mt-0.5">Venue: {m.venue}</p>}
            {m.attendees.length > 0 && <p className="text-sm text-forest-900/60">Attendees: {m.attendees.join(', ')}</p>}
            {m.agenda.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-forest-900/60 uppercase tracking-wide">Agenda</p>
                <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                  {m.agenda.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {m.resolutions.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-forest-900/60 uppercase tracking-wide">Resolutions</p>
                <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                  {m.resolutions.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {membership?.role === 'chair' && (
              <button className="text-sm font-semibold text-brick-500 mt-3" onClick={() => remove(m.id)}>
                Delete
              </button>
            )}
            {exportsAllowed && (
              <button className="text-sm font-semibold text-forest-700 mt-3 ml-4" onClick={() => exportPdf(m.id)} disabled={exportingId === m.id}>
                {exportingId === m.id ? 'Exporting…' : 'Export PDF'}
              </button>
            )}
          </div>
        ))}
        {!minutes.length && <p className="text-forest-900/50">No minutes recorded yet.</p>}
        {exportError && <p className="text-sm text-brick-500 font-medium">{exportError}</p>}
      </div>
    </div>
  );
}

function MinutesForm({ chamaId, recordedBy, onDone }: { chamaId: string; recordedBy: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [venue, setVenue] = useState('');
  const [attendees, setAttendees] = useState('');
  const [agenda, setAgenda] = useState('');
  const [resolutions, setResolutions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function lines(text: string): string[] {
    return text.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  async function submit() {
    setError(null);
    if (!title.trim()) {
      setError('Give the meeting a title.');
      return;
    }
    setBusy(true);
    try {
      const ref = doc(collection(db, paths.minutes(chamaId)));
      await setDoc(ref, {
        title: title.trim(),
        date,
        venue: venue.trim() || null,
        attendees: lines(attendees),
        agenda: lines(agenda),
        resolutions: lines(resolutions),
        recordedBy,
        createdAt: Date.now(),
      });
      onDone();
    } catch {
      setError('Could not save the minutes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 max-w-md flex flex-col gap-3">
      <h3 className="font-display font-semibold">Record minutes</h3>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Venue (optional)
        <input value={venue} onChange={(e) => setVenue(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Attendees (one per line)
        <textarea value={attendees} onChange={(e) => setAttendees(e.target.value)} disabled={busy} rows={3} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Agenda (one item per line)
        <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} disabled={busy} rows={3} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Resolutions (one per line)
        <textarea value={resolutions} onChange={(e) => setResolutions(e.target.value)} disabled={busy} rows={3} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-primary text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50">
          {busy ? 'Saving…' : 'Save minutes'}
        </button>
        <button onClick={onDone} disabled={busy} className="border border-forest-200 text-sm font-semibold px-4 py-2 rounded-full">
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-brick-500 font-medium">{error}</p>}
    </div>
  );
}
