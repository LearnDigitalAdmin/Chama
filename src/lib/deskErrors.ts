import { describeCallError } from './errorMessages';

/** The desk callables return user-readable messages (limits, bad codes) — show them instead of the generic plan-limit text. */
export function describeDeskError(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  const msg = (e as { message?: string })?.message;
  if (msg && (code.includes('invalid-argument') || code.includes('resource-exhausted') || code.includes('failed-precondition'))) {
    return msg;
  }
  return describeCallError(e).message;
}
