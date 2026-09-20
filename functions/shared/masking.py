"""
NEW IN PHASE 1 — not present in the original global package; added here
because member-creation logic needs it in more than one callable
(createChama, addAdmin, addMember, claimInvite, completeProfile). Mirrored
in src/lib/masking.ts. Back-ported into the shared package per
docs/CONVENTIONS.md §2/§7 — future phases should import from here rather
than re-deriving these.
"""

from __future__ import annotations

_AVATAR_PALETTE = [
    "#2563EB", "#DC2626", "#059669", "#D97706",
    "#7C3AED", "#DB2777", "#0891B2", "#65A30D",
]


def mask_id_number(id_number: str) -> tuple[str, str]:
    """Returns (idLast4, nationalIdMasked). Never store/return the raw
    idNumber to anyone but a finance admin or the member themself — see
    firestore.rules and functions/shared/roles.py."""
    digits = "".join(c for c in (id_number or "") if c.isalnum())
    last4 = digits[-4:] if len(digits) >= 4 else digits
    masked = ("•" * max(0, len(digits) - 4)) + last4
    return last4, masked


def initials_and_color(name: str) -> tuple[str, str]:
    """Deterministic avatar initial + color so the same name always renders
    the same way across the app and (independently) the WhatsApp bot."""
    parts = [p for p in (name or "").strip().split() if p]
    initial = (parts[0][0] + parts[-1][0]).upper() if len(parts) >= 2 else (parts[0][:1].upper() if parts else "?")
    idx = sum(ord(c) for c in (name or "")) % len(_AVATAR_PALETTE)
    return initial, _AVATAR_PALETTE[idx]
