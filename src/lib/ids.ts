/**
 * Mirrors functions/shared/ids.py::slugify. Loan product document IDs are
 * slugs (e.g. flat_emergency), not auto-IDs — see firestoreData.json's
 * conventions. The frontend creates loan products directly (see
 * src/features/loans/LoanProducts.tsx), so it needs this too.
 */
export function slugify(text: string): string {
  let cleaned = (text || '')
    .trim()
    .toLowerCase()
    .split('')
    .map((c) => (/[a-z0-9]/.test(c) ? c : '_'))
    .join('');
  while (cleaned.includes('__')) cleaned = cleaned.replace(/__/g, '_');
  return cleaned.replace(/^_+|_+$/g, '');
}
