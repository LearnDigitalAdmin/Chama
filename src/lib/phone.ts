/**
 * Phone normalisation — MUST produce byte-identical output to
 * functions/shared/phone.py (this repo) and CYBER's mychama.service.ts.
 * members.phoneNormalized is the collection-group lookup key the WhatsApp
 * bot depends on; a divergent implementation here silently breaks WhatsApp
 * access for any member added or edited through the app.
 */

const AIRTEL_PREFIXES = ['073', '075', '078'];

export function normalizePhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');

  if (/^254[17]\d{8}$/.test(digits)) return '+' + digits;
  if (/^0[17]\d{8}$/.test(digits)) return '+254' + digits.substring(1);
  if (/^[17]\d{8}$/.test(digits)) return '+254' + digits;

  return digits ? '+' + digits : '';
}

export function localPhone(e164: string): string {
  const digits = String(e164 || '').replace(/\D/g, '');
  return digits.startsWith('254') ? '0' + digits.substring(3) : digits;
}

export function detectProvider(phone: string): 'mpesa' | 'airtel' {
  const local = localPhone(normalizePhone(phone));
  const prefix3 = local.slice(0, 3);
  return AIRTEL_PREFIXES.includes(prefix3) ? 'airtel' : 'mpesa';
}

export function isValidKenyanPhone(phone: string): boolean {
  return normalizePhone(phone) !== '' && /^\+254[17]\d{8}$/.test(normalizePhone(phone));
}
