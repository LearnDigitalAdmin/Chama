"""
Public chama codes (SMC-0001 …) and desk agent codes (COG-0001 …).

publicCode is what a desk agent types to find a chama. It comes from ONE atomic counter and is reserved by
creating `publicCodes/{code}` inside the same transaction (create-only), so two chamas can never share a code
and a code resolves to its chama with a single document read. Chama DOCUMENT IDs are unchanged.
Codes have at least 4 digits and simply grow (SMC-99999, SMC-100000 …).
"""

from __future__ import annotations

import re

from firebase_admin import firestore

from . import firestore_paths as paths
from .dates import now_ms

PUBLIC_CODE_PREFIX = "SMC-"
PUBLIC_CODE_RE = re.compile(r"^SMC-\d{4,}$")
AGENT_CODE_RE = re.compile(r"^COG-\d{4,}$")
TOP_DESK_CODE = "COG-0000"
MAX_DESKS_PER_CHAMA = 5  # connected support agents (COG-0000 is not counted: it is always present)

COUNTER_DOC = "deskCounters/chamaPublicCode"
PUBLIC_CODES_COLLECTION = "publicCodes"


def format_public_code(n: int) -> str:
    if isinstance(n, bool) or not isinstance(n, int) or n < 1:
        raise ValueError("public code number must be a positive integer")
    return f"{PUBLIC_CODE_PREFIX}{n:04d}"


def normalize_public_code(raw: object) -> str | None:
    """Upper-cases and trims; returns None unless the value is a well-formed SMC code."""
    if not isinstance(raw, str):
        return None
    code = raw.strip().upper()
    return code if PUBLIC_CODE_RE.match(code) else None


def normalize_agent_code(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    code = raw.strip().upper()
    return code if AGENT_CODE_RE.match(code) else None


def assign_public_code(transaction, db, chama_ref) -> str:
    """
    Call INSIDE a transaction, before any write in it (Firestore requires reads first). Allocates the next
    code, reserves it, and stamps it on the chama document. Returns the code. If the chama already has one
    the existing code is returned and nothing is changed (idempotent for the backfill).
    """
    chama_snap = chama_ref.get(transaction=transaction)
    existing = (chama_snap.to_dict() or {}).get("publicCode") if chama_snap.exists else None
    if existing:
        return existing

    counter_ref = db.document(COUNTER_DOC)
    counter_snap = counter_ref.get(transaction=transaction)
    last = int((counter_snap.to_dict() or {}).get("last", 0)) if counter_snap.exists else 0

    n = last + 1
    code = format_public_code(n)
    code_ref = db.document(f"{PUBLIC_CODES_COLLECTION}/{code}")
    # Defence in depth: the counter is the source of uniqueness, but never overwrite a reserved code.
    if code_ref.get(transaction=transaction).exists:
        raise RuntimeError(f"public code {code} is already reserved — counter out of step")

    ts = now_ms()
    transaction.set(counter_ref, {"last": n, "updatedAt": ts})
    transaction.set(code_ref, {"chamaId": chama_ref.id, "createdAt": ts})
    if chama_snap.exists:
        transaction.update(chama_ref, {"publicCode": code})
    return code


def allocate_for_existing_chama(db, chama_id: str) -> str:
    """Gives an existing chama a code in its own transaction (backfill, and the lazy path in Settings)."""

    @firestore.transactional
    def _txn(transaction: firestore.Transaction) -> str:
        return assign_public_code(transaction, db, db.document(paths.chama(chama_id)))

    return _txn(db.transaction())


def resolve_chama_id(db, code: str) -> str | None:
    """publicCode -> chama document id, or None. Verifies the chama document still carries that code."""
    norm = normalize_public_code(code)
    if norm is None:
        return None
    snap = db.document(f"{PUBLIC_CODES_COLLECTION}/{norm}").get()
    if not snap.exists:
        return None
    chama_id = (snap.to_dict() or {}).get("chamaId")
    if not chama_id:
        return None
    chama = db.document(paths.chama(chama_id)).get()
    if not chama.exists or (chama.to_dict() or {}).get("publicCode") != norm:
        return None
    return chama_id
