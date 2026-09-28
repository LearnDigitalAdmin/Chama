/**
 * SMS segmentation & content rules — MUST stay value-identical to
 * functions/shared/sms_validation.py. See that file's docstring for why
 * these rules exist (esp. why PLANS[plan].smsRate must never be
 * multiplied into the credits-per-send charge again).
 *
 * Used by src/features/communication/Communication.tsx for the compose
 * and scheduled-message forms' live cost preview, send/schedule button
 * gating, and content validation. Mirrored server-side (functions/mychama/sms.py)
 * as the source of truth — this file is a UX layer, not the enforcement point.
 */

// Cumulative character caps: <=140 chars -> 1 segment, <=270 -> 2, <=385 -> 3.
export const SMS_SEGMENT_BREAKPOINTS = [140, 270, 385] as const;
export const MAX_SMS_LENGTH = SMS_SEGMENT_BREAKPOINTS[SMS_SEGMENT_BREAKPOINTS.length - 1];
export const MAX_SMS_SEGMENTS = SMS_SEGMENT_BREAKPOINTS.length;

/** Returns 1/2/3 segments, 0 for an empty message, or null if over the 385-char cap. */
export function countSmsSegments(message: string): number | null {
  const length = message.length;
  if (length === 0) return 0;
  for (let i = 0; i < SMS_SEGMENT_BREAKPOINTS.length; i++) {
    if (length <= SMS_SEGMENT_BREAKPOINTS[i]) return i + 1;
  }
  return null;
}

// Letters, digits, whitespace, and standard punctuation only — deliberately
// excludes emoji and other non-GSM-7 characters.
const ALLOWED_PUNCTUATION = `.,!?'"\\-:;()/&@%+=_`;
const ALLOWED_CHARS_RE = new RegExp(`^[A-Za-z0-9\\s${ALLOWED_PUNCTUATION}]*$`);

// Catches http(s)/www links plus bare "word.tld" links pasted without a
// scheme. Conservative on purpose — see the .py mirror's comment.
const URL_RE = /(?:https?:\/\/|www\.)\S+|\b(?:[a-zA-Z0-9-]+\.)+(?:com|co\.ke|org|net|io|me|ke|info|biz|co)\b(?:\/\S*)?/gi;
const WHATSAPP_HOSTS = ['wa.me', 'chat.whatsapp.com', 'api.whatsapp.com', 'whatsapp.com'];

function isWhatsAppLink(url: string): boolean {
  const lowered = url.toLowerCase();
  return WHATSAPP_HOSTS.some((host) => lowered.includes(host));
}

/** Returns a user-facing error string if the message breaks content rules, else null. */
export function validateSmsContent(message: string): string | null {
  if (!ALLOWED_CHARS_RE.test(message)) {
    return 'Remove emojis or special characters — SMS only allows letters, numbers, and standard punctuation.';
  }
  const links = message.match(URL_RE) ?? [];
  for (const link of links) {
    if (!isWhatsAppLink(link)) {
      return 'Only WhatsApp links (wa.me or whatsapp.com) are allowed in SMS messages.';
    }
  }
  return null;
}
