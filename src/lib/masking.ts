/**
 * NEW IN PHASE 1 — mirrors functions/shared/masking.py exactly. See that
 * file's docstring for why this exists as a shared module rather than
 * being inlined per-component.
 */

const AVATAR_PALETTE = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#65A30D'];

export function maskIdNumber(idNumber: string): { idLast4: string; nationalIdMasked: string } {
  const digits = (idNumber || '').replace(/[^a-zA-Z0-9]/g, '');
  const last4 = digits.length >= 4 ? digits.slice(-4) : digits;
  const masked = '•'.repeat(Math.max(0, digits.length - 4)) + last4;
  return { idLast4: last4, nationalIdMasked: masked };
}

export function initialsAndColor(name: string): { initial: string; avatarColor: string } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  const initial =
    parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : (parts[0]?.[0] || '?').toUpperCase();
  let sum = 0;
  for (const c of name || '') sum += c.charCodeAt(0);
  return { initial, avatarColor: AVATAR_PALETTE[sum % AVATAR_PALETTE.length] };
}
