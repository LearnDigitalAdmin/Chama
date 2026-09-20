"""
Role & membership resolution for callable functions.

The Admin SDK (which every Python callable uses) BYPASSES firestore.rules
entirely. That means every callable that isn't purely for the caller's own
document MUST re-check role authorisation in code — this module is that
check, and it MUST stay logically identical to the `isMember` / `roleIn` /
`isFinanceAdmin` family of helpers in firestore.rules.

Usage:
    from shared.roles import get_membership, require_role

    membership = get_membership(db, uid, chama_id)
    require_role(membership, ["chair", "treasurer"])
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from . import firestore_paths as paths
from .errors import denied, not_found

FINANCE_ADMIN_ROLES = ("chair", "treasurer")
OFFICIAL_ROLES = ("chair", "treasurer", "secretary")


@dataclass
class Membership:
    uid: str
    chama_id: str
    chama_name: str
    member_id: str
    role: str
    status: str

    @property
    def is_finance_admin(self) -> bool:
        return self.role in FINANCE_ADMIN_ROLES and self.status == "active"

    @property
    def is_official(self) -> bool:
        return self.role in OFFICIAL_ROLES and self.status == "active"

    @property
    def is_active(self) -> bool:
        return self.status == "active"


def get_membership(db, uid: str, chama_id: str) -> Optional[Membership]:
    """
    Single get() against userChamas/{uid}/memberships/{chamaId} — the same
    rules-support index firestore.rules reads. Returns None if the user has
    no active record for this chama.
    """
    snap = db.document(paths.user_chama_membership(uid, chama_id)).get()
    if not snap.exists:
        return None
    data = snap.to_dict()
    return Membership(
        uid=uid,
        chama_id=chama_id,
        chama_name=data.get("chamaName", ""),
        member_id=data["memberId"],
        role=data["role"],
        status=data.get("status", "inactive"),
    )


def require_membership(db, uid: str, chama_id: str) -> Membership:
    m = get_membership(db, uid, chama_id)
    if m is None or not m.is_active:
        raise not_found("You are not an active member of this chama.")
    return m


def require_role(membership: Membership, roles: Iterable[str]) -> Membership:
    if not membership.is_active or membership.role not in roles:
        raise denied(f"This action requires one of: {', '.join(roles)}.")
    return membership


def require_finance_admin(db, uid: str, chama_id: str) -> Membership:
    m = require_membership(db, uid, chama_id)
    if not m.is_finance_admin:
        raise denied("This action requires the chair or treasurer role.")
    return m


def require_official(db, uid: str, chama_id: str) -> Membership:
    m = require_membership(db, uid, chama_id)
    if not m.is_official:
        raise denied("This action requires an official role (chair, treasurer or secretary).")
    return m
