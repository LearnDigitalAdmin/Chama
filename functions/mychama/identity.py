"""
Phase 1 — Identity & Access callables.

Implements the six callables specified in docs/API_CONTRACT.md's Phase 1
section, exactly to that contract. See docs/ARCHITECTURE.md §3 for the
auth model and invite/claim flow these implement.

Every callable here re-derives authorisation from Firestore itself
(functions/shared/roles.py) — the Admin SDK bypasses firestore.rules, so
this module IS the enforcement for anything more complex than "read your
own doc".
"""

from __future__ import annotations

from firebase_functions import https_fn, options
from firebase_admin import firestore
from google.api_core import exceptions as gexc

from shared import firestore_paths as paths
from shared import ids
from shared.constants import PLANS
from shared.desk_codes import assign_public_code
from shared.dates import now_ms, today_iso
from shared.errors import ErrorCode, bad_request, denied, not_found, precondition, rate_limited, require_auth
from shared.id_key import compute_id_key
from shared.idempotency import already_applied, record_result
from shared.masking import initials_and_color, mask_id_number
from shared.phone import is_valid_kenyan_phone, normalize_phone
from shared.roles import require_finance_admin, require_membership
from shared.secrets import ID_PEPPER

REGION = "africa-south1"

FINANCE_ADMIN_ROLES = ("chair", "treasurer")
OFFICIAL_ROLES = ("chair", "treasurer", "secretary")
INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000  # 30 days


def _db():
    return firestore.client()


# ---------------------------------------------------------------------------
# One ID number, one member — per chama.
#
# Every member carries `idKey` (shared/id_key.py). A lock document at
# chamas/{chamaId}/memberIdKeys/{idKey} is created in the SAME batch/transaction as the member with
# create(), which fails if the lock exists — so two members can never share an ID, even under
# concurrent requests. Scope: every member that is not 'removed' (active, inactive and suspended all
# hold their ID); permanently removing a member releases it. The PAY<->MyChama link relies on this:
# two members with one ID in a chama are deliberately never linked.
# ---------------------------------------------------------------------------

DUPLICATE_ID_MESSAGE = "A member with this ID number is already in this chama."
DUPLICATE_ID_SELF_MESSAGE = (
    "That ID number is already registered to another member of this chama. "
    "Check the number, or ask your chama's admin."
)


def try_id_key(id_number: str) -> str:
    """The idKey for an ID number, or '' when there is nothing to key or no pepper is bound. Never raises."""
    return compute_id_key(id_number or "", ID_PEPPER.value)


def id_key_for(id_number: str) -> str:
    """
    The idKey for an ID number — also the document id of the member's uniqueness lock. Fails CLOSED: without
    the pepper the lock would be meaningless, so refuse the write instead of creating an unprotected member.
    """
    if not ID_PEPPER.value:
        raise https_fn.HttpsError(
            ErrorCode.INTERNAL, "Member ID checks are unavailable right now. Please try again shortly."
        )
    key = try_id_key(id_number)
    if not key:
        raise bad_request("A valid ID number is required.")
    return key


def id_lock_ref(db, chama_id: str, id_key: str):
    return db.document(paths.member_id_key(chama_id, id_key))


def _lock_doc(member_id: str) -> dict:
    return {"memberId": member_id, "createdAt": now_ms()}


def reap_orphan_id_lock(db, chama_id: str, id_key: str) -> None:
    """
    Frees a lock nobody holds any more: its member doc is gone (console delete), is 'removed', or no longer
    carries this ID (console edit). Without this one stray lock would block that ID in the chama forever.
    """
    lock = id_lock_ref(db, chama_id, id_key).get()
    if not lock.exists:
        return
    holder_id = (lock.to_dict() or {}).get("memberId")
    holder = db.document(paths.member(chama_id, holder_id)).get() if holder_id else None
    data = holder.to_dict() if holder is not None and holder.exists else None
    if data is None or data.get("status") == "removed" or try_id_key(data.get("idNumber") or "") != id_key:
        lock.reference.delete()


def find_id_holder(db, chama_id: str, id_key: str, *, exclude_member_id: str | None = None):
    """(memberId, data) of a non-removed member already holding this ID, or None. Friendly pre-check only —
    the lock's create() is what actually guarantees uniqueness."""
    for snap in db.collection(paths.members(chama_id)).where("idKey", "==", id_key).limit(5).stream():
        if snap.id == exclude_member_id:
            continue
        data = snap.to_dict() or {}
        if data.get("status") == "removed":
            continue
        return snap.id, data
    return None


def _duplicate_for_admin(holder: dict) -> https_fn.HttpsError:
    """Admins already see the roster, so name the existing member and point at the right fix."""
    name = (holder.get("name") or "A member").strip()
    status = holder.get("status") or "active"
    if status != "active":
        return https_fn.HttpsError(
            ErrorCode.ALREADY_EXISTS,
            f"{name} already has this ID number in this chama (currently {status}). "
            "Reactivate them instead of adding them again.",
        )
    return https_fn.HttpsError(ErrorCode.ALREADY_EXISTS, f"{name} already has this ID number in this chama.")


def member_field_errors(name: str, phone: str, id_number: str) -> list[tuple[str, str]]:
    """The member field rules as (field, reason) pairs — one place, used by _new_member_doc and desk's import validation."""
    errors: list[tuple[str, str]] = []
    if not isinstance(name, str) or not name.strip():
        errors.append(("name", "Name is required."))
    if not isinstance(phone, str) or not is_valid_kenyan_phone(phone):
        errors.append(("phone", "Enter a valid Kenyan phone number (07xx/01xx or +254...)."))
    if not isinstance(id_number, str) or len(id_number.strip()) < 4:
        errors.append(("idNumber", "A valid ID number is required."))
    return errors


def _new_member_doc(*, name: str, phone: str, id_number: str, role: str, uid: str | None) -> dict:
    field_errors = member_field_errors(name, phone, id_number)
    if field_errors:
        raise bad_request(field_errors[0][1])

    id_key = id_key_for(id_number)
    id_last4, id_masked = mask_id_number(id_number)
    initial, avatar_color = initials_and_color(name)
    ts = now_ms()

    return {
        "uid": uid,
        "name": name.strip(),
        "phone": phone.strip(),
        "phoneNormalized": normalize_phone(phone),
        "role": role,
        "isAdmin": role in FINANCE_ADMIN_ROLES or role == "secretary",
        "idNumber": id_number.strip(),
        "idKey": id_key,
        "idLast4": id_last4,
        "nationalIdMasked": id_masked,
        "joinDate": today_iso(),
        "status": "active",
        "totalContributed": 0,
        "creditBalance": 0,
        "avatarColor": avatar_color,
        "initial": initial,
        "whatsappOptIn": True,
        "createdAt": ts,
        "updatedAt": ts,
    }


def ensure_member_capacity(db, chama_id: str, plan: str, *, adding: int) -> int:
    """
    The plan's active-member limit (ALL active members, admins included). Raises rate_limited if adding
    `adding` more would exceed it; returns the current active count. Shared by addMember/addAdmin and by
    desk's commit_records (functions/mychama/desk_delegate.py) so the rule exists in exactly one place.
    """
    limit = PLANS.get(plan, PLANS["free"])["memberLimit"]
    active = len(list(db.collection(paths.members(chama_id)).where("status", "==", "active").stream()))
    if active + adding > limit:
        raise rate_limited(
            f"This chama's {plan} plan allows up to {limit} active members. Upgrade the plan to add more."
        )
    return active


def stage_member(db, batch, chama_id: str, *, role: str, name: str, phone: str, id_number: str, created_by: str) -> tuple[str, str]:
    """
    Validates and stages a member document, its pending invite and the member's ID lock on `batch`; returns
    (memberId, inviteId). Commit the batch inside try/except gexc.AlreadyExists: that is the signal that the
    ID number is already taken in this chama (the whole batch is then rejected, nothing is written).
    """
    member_ref = db.collection(paths.members(chama_id)).document()
    member_doc = _new_member_doc(name=name, phone=phone, id_number=id_number, role=role, uid=None)
    reap_orphan_id_lock(db, chama_id, member_doc["idKey"])
    invite_ref = db.collection(paths.invites(chama_id)).document()
    ts = now_ms()
    batch.set(member_ref, member_doc)
    batch.create(id_lock_ref(db, chama_id, member_doc["idKey"]), _lock_doc(member_ref.id))
    batch.set(invite_ref, {
        "chamaId": chama_id,
        "memberId": member_ref.id,
        "phone": normalize_phone(phone),
        "role": role,
        "status": "pending",
        "createdBy": created_by,
        "createdAt": ts,
        "expiresAt": ts + INVITE_TTL_MS,
    })
    return member_ref.id, invite_ref.id


# ---------------------------------------------------------------------------
# createChama
# ---------------------------------------------------------------------------

@https_fn.on_call(region=REGION, secrets=[ID_PEPPER])
def createChama(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    token = req.auth.token or {}

    if not token.get("email"):
        raise precondition("Sign in with an email address to create a chama.")
    if not token.get("email_verified"):
        raise precondition("Please verify your email before creating a chama. Check your inbox.")

    data = req.data or {}
    name = (data.get("name") or "").strip()
    motto = (data.get("motto") or "").strip()
    contribution_amount = data.get("contributionAmount")
    contribution_cycle = data.get("contributionCycle")
    admin_name = (data.get("adminName") or "").strip()
    admin_phone = data.get("adminPhone") or ""
    admin_id_number = data.get("adminIdNumber") or ""
    # Opening balance: what the chama already had banked before joining the
    # app. Optional (defaults to 0) so the dashboard's Group balance isn't
    # misleadingly zero for a group that's been running for years. Only
    # settable here because there's no treasurer yet to gate it — every
    # later change goes through the treasurer-only path in firestore.rules.
    opening_balance = data.get("openingBalance", 0)

    if not name:
        raise bad_request("Chama name is required.")
    if contribution_cycle not in ("daily", "weekly", "monthly"):
        raise bad_request("contributionCycle must be daily, weekly, or monthly.")
    if not isinstance(contribution_amount, (int, float)) or contribution_amount <= 0:
        raise bad_request("contributionAmount must be a positive number.")
    if not isinstance(opening_balance, (int, float)) or opening_balance < 0:
        raise bad_request("openingBalance must be zero or a positive number.")

    db = _db()
    chama_ref = db.collection(paths.MC.CHAMAS).document()
    chama_id = chama_ref.id
    member_ref = db.collection(paths.members(chama_id)).document()
    member_id = member_ref.id
    membership_ref = db.document(paths.user_chama_membership(uid, chama_id))

    ts = now_ms()

    @firestore.transactional
    def _txn(transaction: firestore.Transaction):
        # Reads first (Firestore rule): allocate the chama's public code (SMC-0001 …) from the atomic counter.
        public_code = assign_public_code(transaction, db, chama_ref)
        member_doc = _new_member_doc(
            name=admin_name or token.get("name") or name,
            phone=admin_phone,
            id_number=admin_id_number,
            role="chair",
            uid=uid,
        )
        transaction.set(chama_ref, {
            "name": name,
            "publicCode": public_code,
            "motto": motto,
            "plan": "free",
            "contributionAmount": float(contribution_amount),
            "contributionCycle": contribution_cycle,
            "openingBalance": float(opening_balance),
            "smsCredits": 0,
            "settlementAccount": None,
            "settlementSplitCode": None,
            "autoSettle": False,
            "minutesExportsUsedThisMonth": 0,
            "standardReportsUsedThisMonth": 0,
            "premiumReportsUsedThisMonth": 0,
            "premiumAlacarteUsedThisMonth": 0,
            "reportCreditsBalance": 0,
            "fiscalYearStartMonth": 1,
            "status": "active",
            "whatsappEnabled": True,
            "createdAt": ts,
            "updatedAt": ts,
        })
        transaction.set(member_ref, member_doc)
        transaction.create(id_lock_ref(db, chama_id, member_doc["idKey"]), _lock_doc(member_id))
        transaction.set(membership_ref, {
            "chamaId": chama_id,
            "chamaName": name,
            "memberId": member_id,
            "role": "chair",
            "status": "active",
            "updatedAt": ts,
        })

    _txn(db.transaction())

    return {"chamaId": chama_id, "memberId": member_id}


# ---------------------------------------------------------------------------
# addAdmin / addMember (shared implementation, different entry points so the
# API surface matches docs/API_CONTRACT.md exactly)
# ---------------------------------------------------------------------------

def _add_person(req: https_fn.CallableRequest, *, forced_role: str | None) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    if not chama_id:
        raise bad_request("chamaId is required.")

    db = _db()
    caller = require_finance_admin(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    role = forced_role or data.get("role") or "member"
    if role not in ("chair", "treasurer", "secretary", "member"):
        raise bad_request("Invalid role.")

    name = data.get("name") or ""
    phone = data.get("phone") or ""
    id_number = data.get("idNumber") or ""
    normalized = normalize_phone(phone)

    chama_snap = db.document(paths.chama(chama_id)).get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()

    plan = chama.get("plan", "free")
    ensure_member_capacity(db, chama_id, plan, adding=1)

    dupe = list(
        db.collection(paths.members(chama_id))
        .where("phoneNormalized", "==", normalized)
        .limit(1)
        .stream()
    )
    if dupe:
        raise https_fn.HttpsError("already-exists", "This phone number is already a member of this chama.")

    field_errors = member_field_errors(name, phone, id_number)
    if field_errors:
        raise bad_request(field_errors[0][1])
    holder = find_id_holder(db, chama_id, id_key_for(id_number))
    if holder:
        raise _duplicate_for_admin(holder[1])

    batch = db.batch()
    member_id, invite_id = stage_member(
        db, batch, chama_id, role=role, name=name, phone=phone, id_number=id_number, created_by=caller.member_id,
    )
    try:
        batch.commit()
    except gexc.AlreadyExists:
        # Lost a race (or the member's idKey hadn't been written yet): the lock is the source of truth.
        raise https_fn.HttpsError(ErrorCode.ALREADY_EXISTS, DUPLICATE_ID_MESSAGE) from None

    result = {"memberId": member_id, "inviteId": invite_id}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION, secrets=[ID_PEPPER])
def addAdmin(req: https_fn.CallableRequest) -> dict:
    role = (req.data or {}).get("role")
    if role not in ("chair", "treasurer", "secretary"):
        raise bad_request("role must be chair, treasurer, or secretary for addAdmin.")
    return _add_person(req, forced_role=role)


@https_fn.on_call(region=REGION, secrets=[ID_PEPPER])
def addMember(req: https_fn.CallableRequest) -> dict:
    return _add_person(req, forced_role="member")


# ---------------------------------------------------------------------------
# claimInvite
# ---------------------------------------------------------------------------

@https_fn.on_call(region=REGION)
def claimInvite(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    token = req.auth.token or {}
    data = req.data or {}
    chama_id = data.get("chamaId")
    invite_id = data.get("inviteId")
    if not chama_id or not invite_id:
        raise bad_request("chamaId and inviteId are required.")

    db = _db()
    invite_ref = db.document(f"{paths.invites(chama_id)}/{invite_id}")
    invite_snap = invite_ref.get()
    if not invite_snap.exists:
        raise not_found("Invite not found.")
    invite = invite_snap.to_dict()

    if invite.get("status") != "pending":
        raise precondition("This invite has already been used, revoked, or expired.")
    if invite.get("expiresAt", 0) < now_ms():
        invite_ref.update({"status": "expired"})
        raise precondition("This invite has expired. Ask your chama admin to resend it.")

    caller_phone = token.get("phone_number")
    if not caller_phone or normalize_phone(caller_phone) != invite.get("phone"):
        raise denied(
            "The phone number on your account doesn't match this invite. "
            "Sign in with the phone number your admin added, or link it to your account first."
        )

    member_ref = db.document(paths.member(chama_id, invite["memberId"]))
    member_snap = member_ref.get()
    if not member_snap.exists:
        raise not_found("The member record for this invite no longer exists.")
    member = member_snap.to_dict()

    chama_snap = db.document(paths.chama(chama_id)).get()
    chama_name = chama_snap.to_dict().get("name", "") if chama_snap.exists else ""

    ts = now_ms()
    batch = db.batch()
    batch.update(member_ref, {"uid": uid, "updatedAt": ts})
    batch.update(invite_ref, {"status": "claimed", "claimedAt": ts, "claimedByUid": uid})
    batch.set(db.document(paths.user_chama_membership(uid, chama_id)), {
        "chamaId": chama_id,
        "chamaName": chama_name,
        "memberId": invite["memberId"],
        "role": member["role"],
        "status": member.get("status", "active"),
        "updatedAt": ts,
    })
    batch.commit()

    return {"memberId": invite["memberId"], "role": member["role"]}


# ---------------------------------------------------------------------------
# claimMyInvites — automatic invite claiming for phone-authenticated sign-ins.
#
# claimInvite (above) requires the admin's invite link to actually reach the
# member (SMS/WhatsApp/email) — nothing in this codebase sends that link.
# Until that exists, a member added by an admin has no way to discover their
# chamaId/inviteId, so their invite sits at status "pending" forever even
# after they sign in with the exact phone number the admin used to add them.
#
# This callable removes the need for a link entirely. Any time a
# phone-authenticated user is signed in, the frontend calls this once (see
# src/auth/AuthProvider.tsx). It looks up every member record across every
# chama that (a) matches the caller's Firebase-verified phone number and
# (b) has no uid yet, attaches this uid, writes the userChamas index (same
# shape as claimInvite/completeProfile), and closes out the matching invite
# doc so it stops sitting at "pending". No link, no SMS, nothing sent.
#
# Idempotent by construction: once a member doc has a uid, the
# `uid == None` filter below no longer matches it, so calling this again
# (e.g. on every sign-in) is a harmless no-op for anything already claimed.
# ---------------------------------------------------------------------------

@https_fn.on_call(region=REGION)
def claimMyInvites(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    token = req.auth.token or {}
    caller_phone = token.get("phone_number")
    if not caller_phone:
        # Not a phone-authenticated session (Google/email) — nothing to
        # auto-claim here; completeProfile covers that path instead.
        return {"claimed": []}

    normalized = normalize_phone(caller_phone)
    db = _db()

    cg = db.collection_group(paths.MC.MEMBERS)
    candidates = list(cg.where("phoneNormalized", "==", normalized).where("uid", "==", None).stream())

    ts = now_ms()
    claimed: list[dict] = []
    for snap in candidates:
        member_ref = snap.reference
        chama_id = member_ref.parent.parent.id
        member = snap.to_dict()

        chama_snap = db.document(paths.chama(chama_id)).get()
        chama_name = chama_snap.to_dict().get("name", "") if chama_snap.exists else ""

        batch = db.batch()
        batch.update(member_ref, {"uid": uid, "updatedAt": ts})
        batch.set(db.document(paths.user_chama_membership(uid, chama_id)), {
            "chamaId": chama_id,
            "chamaName": chama_name,
            "memberId": member_ref.id,
            "role": member.get("role", "member"),
            "status": member.get("status", "active"),
            "updatedAt": ts,
        })

        # Close out any invite(s) still pending for this member so they
        # stop showing as pending forever — the same end state claimInvite
        # would have left them in, just reached without a link.
        pending_invites = (
            db.collection(paths.invites(chama_id))
            .where("memberId", "==", member_ref.id)
            .where("status", "==", "pending")
            .stream()
        )
        for inv in pending_invites:
            batch.update(inv.reference, {"status": "claimed", "claimedAt": ts, "claimedByUid": uid})

        batch.commit()
        claimed.append({
            "chamaId": chama_id,
            "chamaName": chama_name,
            "memberId": member_ref.id,
            "role": member.get("role", "member"),
        })

    return {"claimed": claimed}


# ---------------------------------------------------------------------------
# completeProfile — for Google (or email) sign-ins that need to supply the
# phone number / ID number the schema requires, and to claim any pending
# member record(s) that phone number matches.
# ---------------------------------------------------------------------------

@https_fn.on_call(region=REGION, secrets=[ID_PEPPER])
def completeProfile(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    phone = data.get("phone") or ""
    id_number = data.get("idNumber")
    chama_id = data.get("chamaId")

    if not is_valid_kenyan_phone(phone):
        raise bad_request("Enter a valid Kenyan phone number (07xx/01xx or +254...).")
    normalized = normalize_phone(phone)
    new_id_key = None
    if id_number:
        if not isinstance(id_number, str):
            raise bad_request("A valid ID number is required.")
        new_id_key = id_key_for(id_number)

    db = _db()

    if chama_id:
        candidates_q = (
            db.collection(paths.members(chama_id))
            .where("phoneNormalized", "==", normalized)
            .where("uid", "==", None)
            .limit(1)
        )
        candidates = list(candidates_q.stream())
        matches = [(chama_id, c) for c in candidates]
    else:
        # Collection-group search across every chama this phone has a
        # pending (uid == None) member record in.
        cg = db.collection_group(paths.MC.MEMBERS)
        candidates_q = cg.where("phoneNormalized", "==", normalized).where("uid", "==", None)
        matches = [(c.reference.parent.parent.id, c) for c in candidates_q.stream()]

    if not matches:
        return {"memberId": None}

    ts = now_ms()
    claimed_member_id = None
    for c_id, snap in matches:
        member = snap.to_dict()
        member_ref = snap.reference
        update = {"uid": uid, "updatedAt": ts}
        batch = db.batch()
        if id_number:
            id_last4, id_masked = mask_id_number(id_number)
            update.update({
                "idNumber": id_number.strip(), "idKey": new_id_key,
                "idLast4": id_last4, "nationalIdMasked": id_masked,
            })
            old_key = member.get("idKey") or try_id_key(member.get("idNumber") or "")
            if old_key != new_id_key:
                # The ID is changing: take the new lock (refused if another member holds it) and release the
                # old one, atomically with the profile update below. The error is deliberately generic — the
                # caller is a member, not an admin, and must not learn who else is on the roster.
                reap_orphan_id_lock(db, c_id, new_id_key)
                if find_id_holder(db, c_id, new_id_key, exclude_member_id=member_ref.id):
                    raise https_fn.HttpsError(ErrorCode.ALREADY_EXISTS, DUPLICATE_ID_SELF_MESSAGE)
                batch.create(id_lock_ref(db, c_id, new_id_key), _lock_doc(member_ref.id))
                if old_key:
                    old_lock = id_lock_ref(db, c_id, old_key).get()
                    if old_lock.exists and (old_lock.to_dict() or {}).get("memberId") == member_ref.id:
                        batch.delete(old_lock.reference)

        chama_snap = db.document(paths.chama(c_id)).get()
        chama_name = chama_snap.to_dict().get("name", "") if chama_snap.exists else ""

        batch.update(member_ref, update)
        batch.set(db.document(paths.user_chama_membership(uid, c_id)), {
            "chamaId": c_id,
            "chamaName": chama_name,
            "memberId": member_ref.id,
            "role": member["role"],
            "status": member.get("status", "active"),
            "updatedAt": ts,
        })
        try:
            batch.commit()
        except gexc.AlreadyExists:
            raise https_fn.HttpsError(ErrorCode.ALREADY_EXISTS, DUPLICATE_ID_SELF_MESSAGE) from None
        claimed_member_id = claimed_member_id or member_ref.id

    return {"memberId": claimed_member_id}


# ---------------------------------------------------------------------------
# updateMember
# ---------------------------------------------------------------------------

ALLOWED_SELF_FIELDS = {"name"}
ALLOWED_ADMIN_FIELDS = {"name", "phone", "role", "status"}


@https_fn.on_call(region=REGION)
def updateMember(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    member_id = data.get("memberId")
    patch = data.get("patch") or {}
    if not chama_id or not member_id or not isinstance(patch, dict):
        raise bad_request("chamaId, memberId, and patch are required.")

    db = _db()
    caller = require_membership(db, uid, chama_id)
    target_ref = db.document(paths.member(chama_id, member_id))
    target_snap = target_ref.get()
    if not target_snap.exists:
        raise not_found("Member not found.")
    target = target_snap.to_dict()
    if target.get("status") == "removed":
        raise precondition("This member was permanently removed and can't be edited.")

    is_self = target.get("uid") == uid
    if caller.is_finance_admin:
        allowed = ALLOWED_ADMIN_FIELDS
    elif is_self:
        allowed = ALLOWED_SELF_FIELDS
    else:
        raise denied("You can only edit your own profile.")

    clean_patch = {k: v for k, v in patch.items() if k in allowed}
    if not clean_patch:
        raise bad_request(f"No editable fields supplied. Allowed: {sorted(allowed)}")

    if "role" in clean_patch and clean_patch["role"] not in ("chair", "treasurer", "secretary", "member"):
        raise bad_request("Invalid role.")
    if "status" in clean_patch and clean_patch["status"] not in ("active", "inactive", "suspended"):
        raise bad_request("Invalid status.")
    if caller.is_finance_admin and target.get("role") == "chair" and clean_patch.get("role") not in (None, "chair"):
        raise denied("Use a dedicated chair-transfer flow to change the chair's role (not implemented in Phase 1).")

    if "phone" in clean_patch:
        new_phone = clean_patch["phone"]
        if not is_valid_kenyan_phone(new_phone):
            raise bad_request("Enter a valid Kenyan phone number (07xx/01xx or +254...).")
        new_normalized = normalize_phone(new_phone)
        dupe = (
            db.collection(paths.members(chama_id))
            .where("phoneNormalized", "==", new_normalized)
            .limit(1)
            .stream()
        )
        if any(d.id != member_id for d in dupe):
            raise https_fn.HttpsError("already-exists", "This phone number is already a member of this chama.")
        clean_patch["phone"] = new_phone.strip()
        clean_patch["phoneNormalized"] = new_normalized

    clean_patch["updatedAt"] = now_ms()
    target_ref.update(clean_patch)

    # Keep the membership index in sync immediately for role/status changes
    # (on_member_write will also fire, this just avoids a listener race for
    # the caller's own optimistic UI).
    if target.get("uid") and ({"role", "status"} & clean_patch.keys()):
        db.document(paths.user_chama_membership(target["uid"], chama_id)).set(
            {k: clean_patch[k] for k in ("role", "status") if k in clean_patch} | {"updatedAt": clean_patch["updatedAt"]},
            merge=True,
        )

    return {"ok": True}


# ---------------------------------------------------------------------------
# removeMemberPermanently — feature-parity pass with the original demo
# (Members audit: "Permanent removal (delete from chama)" + "Removal
# dependency checks").
#
# The demo deleted the member document outright. firestore.rules
# deliberately refuses that here ("Members are deactivated, never deleted —
# their ledger history must stay resolvable" — see the `members` match
# block): every transaction, contribution, loan and MGR record references
# memberId, so a real delete would leave dangling references throughout the
# chama's financial history. This callable restores the demo's INTENT —
# "this person is gone for good, stop counting them, stop letting them be
# re-added to anything" — as a terminal fourth status ('removed'), reachable
# only from here (the rules' direct-write branch for finance admins now only
# accepts active/inactive/suspended — see firestore.rules). It's blocked
# exactly like the demo blocked a removal: while the member has an
# unsettled loan or still belongs to a not-yet-finished MGR pot, mirroring
# the mgrCloseForever / exit-settlement dependency-check pattern elsewhere
# in this codebase.
# ---------------------------------------------------------------------------

OPEN_LOAN_STATUSES = ("pending_approval", "awaiting_treasurer", "approved", "active", "overdue")
OPEN_POT_STATUSES = ("draft", "active")


@https_fn.on_call(region=REGION, secrets=[ID_PEPPER])
def removeMemberPermanently(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    member_id = data.get("memberId")
    if not chama_id or not member_id:
        raise bad_request("chamaId and memberId are required.")

    db = _db()
    require_finance_admin(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    member_ref = db.document(paths.member(chama_id, member_id))
    member_snap = member_ref.get()
    if not member_snap.exists:
        raise not_found("Member not found.")
    member = member_snap.to_dict()

    if member.get("status") == "removed":
        result = {"ok": True}
        record_result(db, chama_id, data.get("clientRequestId"), result)
        return result

    if member.get("role") == "chair":
        raise denied("The chair can't be removed this way — transfer the chair role first.")

    open_loans = list(
        db.collection(paths.loans(chama_id))
        .where("memberId", "==", member_id)
        .where("status", "in", list(OPEN_LOAN_STATUSES))
        .stream()
    )
    open_pots = list(
        db.collection(paths.mgr_pots(chama_id))
        .where("memberIds", "array_contains", member_id)
        .where("status", "in", list(OPEN_POT_STATUSES))
        .stream()
    )
    if open_loans or open_pots:
        parts = []
        if open_loans:
            parts.append(f"{len(open_loans)} unsettled loan{'s' if len(open_loans) != 1 else ''}")
        if open_pots:
            parts.append(f"{len(open_pots)} open merry-go-round pot{'s' if len(open_pots) != 1 else ''}")
        raise precondition(
            f"Settle {' and '.join(parts)} before permanently removing this member "
            "(exit them from any pot and clear their loan first)."
        )

    ts = now_ms()
    batch = db.batch()
    batch.update(member_ref, {"status": "removed", "removedAt": ts, "removedBy": uid, "updatedAt": ts})

    # Same membership-index sync updateMember does for a role/status change —
    # so a removed member's session immediately reflects they're out, rather
    # than waiting on the on_member_write trigger.
    if member.get("uid"):
        batch.set(
            db.document(paths.user_chama_membership(member["uid"], chama_id)),
            {"status": "removed", "updatedAt": ts},
            merge=True,
        )

    # Release the member's ID so the number can be registered again (a removed member is terminal).
    held_key = member.get("idKey") or try_id_key(member.get("idNumber") or "")
    if held_key:
        lock = id_lock_ref(db, chama_id, held_key).get()
        if lock.exists and (lock.to_dict() or {}).get("memberId") == member_id:
            batch.delete(lock.reference)
    batch.commit()

    result = {"ok": True}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result
