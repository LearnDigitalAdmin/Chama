"""
members.idKey — a keyed, normalised fingerprint of a member's National ID /
passport number, so another product (the PAY payments hub) can find a person's
chama memberships WITHOUT the raw ID ever being indexed or sent around.

Why it exists: members.idNumber is deliberately index-exempt (see INDEXES.md),
so "find every member with this ID" is impossible on the raw field. idKey is a
separate, indexed field.

    idKey = HMAC_SHA256_hex(pepper, "id:" + normalize_id_number(idNumber))

CROSS-REPO CONTRACT — must stay byte-for-byte identical to PAY's
functions/src/mychama/config.ts (normalizeIdNumber / computeIdKey). The shared
test vectors live in functions/tests/test_id_key.py and in PAY's
docs/mychama/track-A-notes.md; change one, change both.
"""

from __future__ import annotations

import hashlib
import hmac
import re


def normalize_id_number(raw: str) -> str:
    """Uppercase and drop every non-alphanumeric: '12 345-678' -> '12345678'."""
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def compute_id_key(raw_id_number: str, pepper: str) -> str:
    """Hex HMAC-SHA256 of the normalised ID, or '' when there is nothing to key."""
    normalized = normalize_id_number(raw_id_number)
    if not normalized or not pepper:
        return ""
    return hmac.new(pepper.encode("utf-8"), f"id:{normalized}".encode("utf-8"), hashlib.sha256).hexdigest()
