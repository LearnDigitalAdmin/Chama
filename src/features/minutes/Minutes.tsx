/**
 * Minutes are entirely direct Firestore writes — firestore.rules lets the
 * secretary or chair create/update, and only the chair delete. Works
 * offline for free via Firestore's persistent local cache.
 *
 * PDF export is fully client-side (see lib/minutesPdf.ts) — it works with
 * no connection at all. Plan/allowance gating is NOT computed here any
 * more (the old per-plan minutesQuota is retired): the reports engine owns
 * it server-side. So an export first logs itself through the queueable
 * recordMinutesExport callable, which charges the shared reports-engine
 * allowance:
 *   - online: if the server rejects it (plan or allowance), we show the
 *     reason and do NOT download;
 *   - offline: the call is queued (QueuedOfflineError) and the download
 *     goes ahead immediately, syncing later — the export never blocks
 *     without a connection.
 */

import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { useMembers, memberName } from '../../app/useMembers';
import { todayISO, fmtDate } from '../../lib/dates';
import { QueuedOfflineError, recordMinutesExport } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { renderMarkdown } from '../../lib/markdown';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import type { ChamaMember, Minute } from '../../lib/types';

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Renders one plain agenda/resolution line with inline bold/italic
 *  support — same Markdown source the PDF export reads. */
function InlineMd({ text }: { text: string }) {
  return <span dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

export default function Minutes() {
  const { chama, chamaId, membership } = useChama();
  const { members } = useMembers(chamaId);
  const [minutes, setMinutes] = useState<Minute[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

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

  async function exportPdf(m: Minute) {
    if (!chamaId || !chama) return;
    setLoggingId(m.id);
    setExportNote(null);

    // 1) Load the exporter first, so a failed load never costs an export.
    // Loaded on demand — jsPDF/autotable/marked have no reason to sit in
    // everyone's initial bundle for a feature most visits never touch.
    // Cached by the browser after the first export, so this is instant
    // from then on, offline included.
    let downloadMinutesPdf: typeof import('../../lib/minutesPdf').downloadMinutesPdf;
    try {
      ({ downloadMinutesPdf } = await import('../../lib/minutesPdf'));
    } catch {
      setExportNote("Couldn't load the PDF exporter — please try again once you're online.");
      setLoggingId(null);
      return;
    }

    // 2) Log/charge the export. The server (reports engine) decides whether
    // the plan and monthly allowance cover it.
    try {
      await recordMinutesExport({ chamaId, minutesId: m.id });
    } catch (e) {
      if (!(e instanceof QueuedOfflineError)) {
        // A real rejection (plan doesn't include exports, allowance used
        // up, etc.) — don't hand over the PDF.
        setExportNote(describeCallError(e).message);
        setLoggingId(null);
        return;
      }
      // Offline: queued and will sync later — carry on and download now.
    }

    // 3) Build and download the PDF, entirely client-side.
    try {
      downloadMinutesPdf({
        chamaName: chama.name,
        title: m.title,
        date: m.date,
        venue: m.venue,
        chairPresent: m.chairPresent,
        recordedByName: memberName(members, m.recordedBy),
        presentNames: m.attendees,
        // Older minutes (recorded before this patch) have no absentees
        // snapshot — fall back to "current roster minus attendees" so they
        // still export sensibly, though membership may have since changed.
        absentNames: m.absentees ?? members.filter((mm) => !m.attendees.includes(mm.name)).map((mm) => mm.name),
        agenda: m.agenda,
        resolutions: m.resolutions,
        aob: m.aob,
        nextMeeting: m.nextMeeting,
      });
    } catch {
      setExportNote("Couldn't build the PDF — please try again.");
    } finally {
      setLoggingId(null);
    }
  }

  const canWrite = membership?.role === 'chair' || membership?.role === 'secretary';

  return (
    <div className="space-y-5">
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-semibold">Minutes</h1>
        {canWrite && (
          <button onClick={() => setShowForm(true)} className="btn-add text-sm">
            + Record minutes
          </button>
        )}
      </div>

      {showForm && chamaId && canWrite && (
        <MinutesForm chamaId={chamaId} members={members} recordedBy={membership!.memberId} onDone={() => setShowForm(false)} />
      )}

      <div className="space-y-4">
        {minutes.map((m) => {
          const absentees = m.absentees ?? [];
          const total = m.attendees.length + absentees.length;
          return (
            <div key={m.id} className="card p-5">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <h3 className="font-display font-semibold">{m.title}</h3>
                <span className="text-xs text-forest-900/50">{fmtDate(m.date)}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-forest-900/60 mt-0.5">
                {m.venue && <span>Venue: {m.venue}</span>}
                <span>Chair {m.chairPresent === false ? 'absent' : 'present'}</span>
                {total > 0 && (
                  <span>
                    {m.attendees.length} of {total} present
                  </span>
                )}
              </div>
              {m.attendees.length > 0 && <p className="text-sm text-forest-900/60 mt-1">Present: {m.attendees.join(', ')}</p>}
              {absentees.length > 0 && <p className="text-sm text-forest-900/40">Absent: {absentees.join(', ')}</p>}

              {m.agenda.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-forest-900/60 uppercase tracking-wide">Agenda</p>
                  <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                    {m.agenda.map((a, i) => (
                      <li key={i}>
                        <InlineMd text={a} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {m.resolutions.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-forest-900/60 uppercase tracking-wide">Resolutions</p>
                  <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                    {m.resolutions.map((r, i) => (
                      <li key={i}>
                        <InlineMd text={r} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {m.aob && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-forest-900/60 uppercase tracking-wide">Any other business</p>
                  <div className="md-preview text-sm mt-1" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.aob) }} />
                </div>
              )}
              {m.nextMeeting && <p className="text-sm text-forest-900/60 mt-2">Next meeting: {fmtDate(m.nextMeeting)}</p>}

              <div className="flex items-center gap-4 mt-3">
                {membership?.role === 'chair' && (
                  <button className="text-sm font-semibold text-brick-500" onClick={() => remove(m.id)}>
                    Delete
                  </button>
                )}
                <button
                  className="text-sm font-semibold text-forest-700 disabled:opacity-50"
                  onClick={() => exportPdf(m)}
                  disabled={loggingId === m.id}
                >
                  {loggingId === m.id ? 'Exporting…' : 'Export PDF'}
                </button>
              </div>
            </div>
          );
        })}
        {!minutes.length && <p className="text-forest-900/50">No minutes recorded yet.</p>}
        {exportNote && <p className="text-sm text-forest-900/60 font-medium">{exportNote}</p>}
      </div>
    </div>
  );
}

function MinutesForm({
  chamaId,
  members,
  recordedBy,
  onDone,
}: {
  chamaId: string;
  members: ChamaMember[];
  recordedBy: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [venue, setVenue] = useState('');
  const [chairPresent, setChairPresent] = useState(true);
  // Absent by exception: unset (not yet toggled) reads as present everywhere
  // below, so a member who loads in a moment after this form mounts still
  // defaults to present without needing an effect to backfill them.
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [agenda, setAgenda] = useState('');
  const [resolutions, setResolutions] = useState('');
  const [aob, setAob] = useState('');
  const [nextMeeting, setNextMeeting] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPresent = (m: ChamaMember) => present[m.id] ?? true;
  const presentCount = members.filter(isPresent).length;

  function setAll(value: boolean) {
    setPresent(value ? {} : Object.fromEntries(members.map((m) => [m.id, false])));
  }

  async function submit() {
    setError(null);
    if (!title.trim()) {
      setError('Give the meeting a title.');
      return;
    }
    setBusy(true);
    try {
      const attendees = members.filter(isPresent).map((m) => m.name);
      const absentees = members.filter((m) => !isPresent(m)).map((m) => m.name);
      const ref = doc(collection(db, paths.minutes(chamaId)));
      await setDoc(ref, {
        title: title.trim(),
        date,
        venue: venue.trim() || null,
        chairPresent,
        attendees,
        absentees,
        agenda: lines(agenda),
        resolutions: lines(resolutions),
        aob: aob.trim() || null,
        nextMeeting: nextMeeting || null,
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
    <div className="card p-5 max-w-2xl flex flex-col gap-3">
      <h3 className="font-display font-semibold">Record minutes</h3>
      <div className="grid sm:grid-cols-2 gap-3">
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
          Next meeting (optional)
          <input type="date" value={nextMeeting} onChange={(e) => setNextMeeting(e.target.value)} disabled={busy} className="px-3 py-2 rounded-lg border border-forest-100" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={chairPresent} onChange={(e) => setChairPresent(e.target.checked)} disabled={busy} className="accent-forest-700 w-4 h-4" />
        Chair present
      </label>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            Attendance — {presentCount} of {members.length} present
          </span>
          <div className="flex gap-3 text-xs font-semibold text-forest-700">
            <button type="button" onClick={() => setAll(true)} disabled={busy}>
              All present
            </button>
            <button type="button" onClick={() => setAll(false)} disabled={busy}>
              All absent
            </button>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-1 max-h-48 overflow-y-auto border border-forest-100 rounded-lg p-2">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded-md hover:bg-forest-50">
              <input
                type="checkbox"
                checked={isPresent(m)}
                onChange={(e) => setPresent((p) => ({ ...p, [m.id]: e.target.checked }))}
                disabled={busy}
                className="accent-forest-700 w-4 h-4"
              />
              {m.name}
            </label>
          ))}
          {!members.length && <p className="text-sm text-forest-900/50 px-2 py-1">No active members yet.</p>}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Agenda (one item per line — **bold**/_italic_ supported)
        <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} disabled={busy} rows={3} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Resolutions (one per line — **bold**/_italic_ supported)
        <textarea value={resolutions} onChange={(e) => setResolutions(e.target.value)} disabled={busy} rows={3} className="px-3 py-2 rounded-lg border border-forest-100" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Any other business (optional)
        <MarkdownEditor value={aob} onChange={setAob} disabled={busy} rows={5} placeholder="Headings, quotes, lists — whatever the discussion needs." />
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