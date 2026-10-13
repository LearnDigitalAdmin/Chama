"""
SMS segmentation & content rules — shared by sendSmsCampaign and
run_sms_schedules (functions/mychama/sms.py).

Segment breakpoints (135 / 250 / 380 chars) are MyChama's own product
rule, not GSM-7 concatenation math: 1 credit is charged per SMS segment,
the same regardless of plan tier. PLANS[plan]['smsRate'] in
shared/constants.py is a *different* number — the KES price per credit
at top-up time — and must never be multiplied into this charge again
(that conflation was the sendSmsCampaign/run_sms_schedules bug this
module fixes).

Content is restricted to GSM-7-safe characters and WhatsApp links only,
so a stray emoji or non-GSM character can't silently push HostPinnacle
into UCS-2 encoding — which would roughly halve the real per-segment
character count and desync what a campaign was charged from what it
actually cost to send.
"""

from __future__ import annotations

import re

# Cumulative character caps: <=135 chars -> 1 segment, <=250 -> 2, <=380 -> 3.
# A message over the last breakpoint is rejected outright (no 4th segment).
SEGMENT_BREAKPOINTS: tuple[int, ...] = (135, 250, 380)
MAX_SMS_LENGTH = SEGMENT_BREAKPOINTS[-1]
MAX_SMS_SEGMENTS = len(SEGMENT_BREAKPOINTS)

# Letters, digits, whitespace, and standard punctuation only — deliberately
# excludes emoji and other non-GSM-7 characters. Extend this set only with
# other plain-punctuation characters, never with symbols that risk pushing
# the message into UCS-2 encoding.
_ALLOWED_PUNCTUATION = r""".,!?'"\-:;()/&@%+=_"""
_ALLOWED_CHARS_RE = re.compile(rf"^[A-Za-z0-9\s{_ALLOWED_PUNCTUATION}]*$")

# Catches http(s)/www links plus bare "word.tld" links people paste without
# a scheme. Conservative on purpose: it will flag some non-link text that
# merely looks like a domain, which is the safe direction to err in here.
_URL_RE = re.compile(
    r"(?:https?://|www\.)\S+|\b(?:[a-zA-Z0-9-]+\.)+(?:com|co\.ke|org|net|io|me|ke|info|biz|co)\b(?:/\S*)?",
    re.IGNORECASE,
)
_WHATSAPP_HOSTS = ("wa.me", "chat.whatsapp.com", "api.whatsapp.com", "whatsapp.com")


def count_sms_segments(message: str) -> int | None:
    """
    Returns 1, 2, or 3 per the 135/250/380 breakpoints, 0 for an empty
    message, or None if the message is over the 380-char hard cap (the
    caller should reject rather than send).
    """
    length = len(message)
    if length == 0:
        return 0
    for i, cap in enumerate(SEGMENT_BREAKPOINTS):
        if length <= cap:
            return i + 1
    return None


def _is_whatsapp_link(url: str) -> bool:
    lowered = url.lower()
    return any(host in lowered for host in _WHATSAPP_HOSTS)


def validate_sms_content(message: str) -> str | None:
    """Returns a user-facing error string if the message breaks content rules, else None."""
    if not _ALLOWED_CHARS_RE.match(message):
        return "Remove emojis or special characters — SMS only allows letters, numbers, and standard punctuation."
    for match in _URL_RE.finditer(message):
        if not _is_whatsapp_link(match.group(0)):
            return "Only WhatsApp links (wa.me or whatsapp.com) are allowed in SMS messages."
    return None


_NAME_CHARS_RE = re.compile(r"[^A-Za-z'\-]")
_DISALLOWED_CHARS_RE = re.compile(rf"[^A-Za-z0-9\s{_ALLOWED_PUNCTUATION}]")


def sms_first_name(full_name: str | None, fallback: str = "Member") -> str:
    """First name of the recipient for the greeting, or `fallback` ("Member"/"Customer") when there is none."""
    parts = (full_name or "").split()
    first = _NAME_CHARS_RE.sub("", parts[0]).title() if parts else ""
    return first or fallback


def compose_sms(body: str, chama_name: str | None, recipient_name: str | None = None, fallback: str = "Member") -> str:
    """
    The text actually sent, and the text that is segmented and charged: "Dear <first name>," on top,
    the body, a blank line, then "<chama name> by MyChama". The greeting and signature count toward the
    135/250/380 limits, so cost must always be computed on this string, never on the bare body.
    """
    chama = " ".join(_DISALLOWED_CHARS_RE.sub("", chama_name or "").split())
    signature = f"{chama} by MyChama" if chama else "MyChama"
    return f"Dear {sms_first_name(recipient_name, fallback)},\n{body}\n\n{signature}"
