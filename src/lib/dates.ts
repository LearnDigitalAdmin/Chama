/**
 * Date helpers — MUST mirror functions/shared/dates.py (this repo) and
 * CYBER's mychama.service.ts (todayISO, addDaysISO, periodKeyOf).
 *
 * Calendar-day fields (paidOn, requestedOn, dueDate, joinDate, date) are ISO
 * date strings 'YYYY-MM-DD' — string-sortable, which every range query in
 * firestore.indexes.json relies on. Do not switch these to Firestore
 * Timestamps without rewriting the indexes.
 *
 * createdAt / updatedAt are epoch MILLISECONDS (number), not Timestamps, to
 * match the WhatsApp bot's session clock and allow cheap numeric range
 * filters.
 */

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days: number, base: Date = new Date()): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Human month key used to sort contribution periods reliably: YYYY-MM. */
export function periodKeyOf(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function nowMs(): number {
  return Date.now();
}

export function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}
