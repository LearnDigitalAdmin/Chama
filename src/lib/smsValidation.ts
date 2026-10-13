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

// Cumulative character caps: <=135 chars -> 1 segment, <=250 -> 2, <=380 -> 3.
export const SMS_SEGMENT_BREAKPOINTS = [135, 250, 380] as const;
export const MAX_SMS_LENGTH = SMS_SEGMENT_BREAKPOINTS[SMS_SEGMENT_BREAKPOINTS.length - 1];
export const MAX_SMS_SEGMENTS = SMS_SEGMENT_BREAKPOINTS.length;

/** Returns 1/2/3 segments, 0 for an empty message, or null if over the 380-char cap. */
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

/** First name for the greeting, or `fallback` ("Member"/"Customer") when there is none. Mirrors sms_first_name(). */
export function smsFirstName(fullName: string | null | undefined, fallback = 'Member'): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  const cleaned = first.replace(/[^A-Za-z'-]/g, '').replace(/[A-Za-z]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return cleaned || fallback;
}

/** The text actually sent and charged: greeting, body, blank line, signature. Mirrors compose_sms(). */
export function composeSms(body: string, chamaName: string | null | undefined, recipientName?: string | null, fallback = 'Member'): string {
  const chama = (chamaName ?? '').replace(new RegExp(`[^A-Za-z0-9\\s${ALLOWED_PUNCTUATION}]`, 'g'), '').split(/\s+/).filter(Boolean).join(' ');
  const signature = chama ? `${chama} by MyChama` : 'MyChama';
  return `Dear ${smsFirstName(recipientName, fallback)},\n${body}\n\n${signature}`;
}

/**
 * Credits for one send, counted per recipient on the full text (greeting + body + signature) — what the
 * server charges. `names` holds one entry per recipient; with none, length is checked against "Dear Member,".
 */
export function estimateSmsCost(
  body: string,
  chamaName: string | null | undefined,
  names: Array<string | null | undefined>
): { credits: number; maxSegments: number; longest: number; tooLong: boolean } {
  if (!body) return { credits: 0, maxSegments: 0, longest: 0, tooLong: false };
  let credits = 0;
  let maxSegments = 0;
  let longest = 0;
  let tooLong = false;
  for (const name of names.length ? names : [undefined]) {
    const text = composeSms(body, chamaName, name);
    longest = Math.max(longest, text.length);
    const segs = countSmsSegments(text);
    if (segs === null) tooLong = true;
    else {
      maxSegments = Math.max(maxSegments, segs);
      if (names.length) credits += segs;
    }
  }
  return { credits: tooLong ? 0 : credits, maxSegments, longest, tooLong };
}
