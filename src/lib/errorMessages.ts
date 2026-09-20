import { QueuedOfflineError, OfflineUnavailableError } from './callables';

/**
 * Every feature screen's catch block should run its error through this
 * rather than hand-rolling "is this offline, is this a real failure"
 * checks — keeps the offline UX (queued vs unavailable vs real rejection)
 * consistent everywhere a callable is used.
 */
export function describeCallError(e: unknown): { message: string; isQueued: boolean } {
  if (e instanceof QueuedOfflineError) {
    return { message: "You're offline — this has been queued and will sync automatically.", isQueued: true };
  }
  if (e instanceof OfflineUnavailableError) {
    return { message: e.message, isQueued: false };
  }
  const code = (e as { code?: string })?.code || '';
  if (code.includes('already-exists')) return { message: 'That already exists.', isQueued: false };
  if (code.includes('resource-exhausted')) return { message: 'A limit was reached for your current plan.', isQueued: false };
  if (code.includes('permission-denied')) return { message: "You don't have permission to do that.", isQueued: false };
  if (code.includes('failed-precondition')) {
    return { message: (e as { message?: string })?.message || 'This action is not available right now.', isQueued: false };
  }
  return { message: 'Something went wrong. Please try again.', isQueued: false };
}
