"""
Phone normalisation — MUST produce byte-identical output to:
  - CYBER/functions/src/services/mychama.service.ts (normalizePhone / localPhone / detectProvider)
  - src/lib/phone.ts (this repo, frontend)

members.phoneNormalized is the collection-group lookup key the WhatsApp bot
depends on. A divergent implementation here silently breaks WhatsApp access
for any member added or edited through the app.
"""

from __future__ import annotations

import re

_AIRTEL_PREFIXES = {"073", "075", "078"}


def normalize_phone(phone: str) -> str:
    """Normalise any Kenyan phone spelling to E.164 (+2547XXXXXXXX / +2541XXXXXXXX)."""
    digits = re.sub(r"\D", "", phone or "")

    if re.fullmatch(r"254[17]\d{8}", digits):
        return "+" + digits
    if re.fullmatch(r"0[17]\d{8}", digits):
        return "+254" + digits[1:]
    if re.fullmatch(r"[17]\d{8}", digits):
        return "+254" + digits

    return ("+" + digits) if digits else ""


def local_phone(e164: str) -> str:
    """Local display form (07XXXXXXXX) for anything shown to a member."""
    digits = re.sub(r"\D", "", e164 or "")
    return "0" + digits[3:] if digits.startswith("254") else digits


def detect_provider(phone: str) -> str:
    """Returns 'mpesa' or 'airtel' based on the local prefix."""
    local = local_phone(normalize_phone(phone))
    prefix3 = local[:3]
    return "airtel" if prefix3 in _AIRTEL_PREFIXES else "mpesa"


def is_valid_kenyan_phone(phone: str) -> bool:
    """Mirrors src/lib/phone.ts::isValidKenyanPhone exactly."""
    import re
    n = normalize_phone(phone)
    return bool(n) and bool(re.fullmatch(r"\+254[17]\d{8}", n))


def normalize_sms_phone(phone: str) -> str:
    """
    254XXXXXXXXX form (no +) — what HostPinnacle expects. Mirrors the PAY
    repo's normalizeSmsPhone() exactly.
    """
    e164 = normalize_phone(phone)
    return e164.lstrip("+")
