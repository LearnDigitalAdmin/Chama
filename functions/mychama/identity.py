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

from shared import firestore_paths as paths
from shared import ids
from shared.constants import PLANS
from shared.dates import now_ms, today_iso
from shared.errors import bad_request, denied, not_found, precondition, rate_limited, require_auth
from shared.idempotency import already_applied, record_result
from shared.masking import initials_and_color, mask_id_number
from shared.phone import is_valid_kenyan_phone, normalize_phone
from shared.roles import require_finance_admin, require_membership

REGION = "africa-south1"

FINANCE_ADMIN_ROLES = ("chair", "treasurer")
OFFICIAL_ROLES = ("chair", "treasurer", "secretary")
INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000  # 30 days


def _db():
    return firestore.client()


def _new_member_doc(*, name: str, phone: str, id_number: str, role: str, uid: str | None) -> dict:
    if not name or not name.strip():
        raise bad_request("Name is required.")
    if not is_valid_kenyan_phone(phone):
        raise bad_request("Enter a valid Kenyan phone number (07xx/01xx or +254...).")
    if not id_number or len(id_number.strip()) < 4:
        raise bad_request("A valid ID number is required.")

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


# ---------------------------------------------------------------------------
# createChama
# ---------------------------------------------------------------------------

@https_fn.on_call(region=REGION)
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

    if not name:
        raise bad_request("Chama name is required.")
    if contribution_cycle not in ("daily", "weekly", "monthly"):
        raise bad_request("contributionCycle must be daily, weekly, or monthly.")
    if not isinstance(contribution_amount, (int, float)) or contribution_amount <= 0:
        raise bad_request("contributionAmount must be a positive number.")

    db = _db()
    chama_ref = db.collection(paths.MC.CHAMAS).document()
    chama_id = chama_ref.id
    member_ref = db.collection(paths.members(chama_id)).document()
    member_id = member_ref.id
    membership_ref = db.document(paths.user_chama_membership(uid, chama_id))

    ts = now_ms()

    @firestore.transactional
    def _txn(transaction: firestore.Transaction):
        member_doc = _new_member_doc(
            name=admin_name or token.get("name") or name,
            phone=admin_phone,
            id_number=admin_id_number,
            role="chair",
            uid=uid,
        )
        transaction.set(chama_ref, {
            "name": name,
            "motto": motto,
            "plan": "free",
            "contributionAmount": float(contribution_amount),
            "contributionCycle": contribution_cycle,
            "smsCredits": 0,
            "settlementAccount": None,
            "settlementSplitCode": None,
            "autoSettle": False,
            "minutesExportsUsedThisMonth": 0,
            "status": "active",
            "whatsappEnabled": True,
            "createdAt": ts,
            "updatedAt": ts,
        })
        transaction.set(member_ref, member_doc)
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
    limit = PLANS.get(plan, PLANS["free"])["memberLimit"]
    existing = list(
        db.collection(paths.members(chama_id))
        .where("status", "==", "active")
        .stream()
    )
    if len(existing) >= limit:
        raise rate_limited(
            f"This chama's {plan} plan allows up to {limit} active members. Upgrade the plan to add more."
        )

    dupe = list(
        db.collection(paths.members(chama_id))
        .where("phoneNormalized", "==", normalized)
        .limit(1)
        .stream()
    )
    if dupe:
        raise https_fn.HttpsError("already-exists", "This phone number is already a member of this chama.")

    member_ref = db.collection(paths.members(chama_id)).document()
    member_id = member_ref.id
    member_doc = _new_member_doc(name=name, phone=phone, id_number=id_number, role=role, uid=None)

    invite_ref = db.collection(paths.invites(chama_id)).document()
    invite_id = invite_ref.id
    ts = now_ms()

    batch = db.batch()
    batch.set(member_ref, member_doc)
    batch.set(invite_ref, {
        "chamaId": chama_id,
        "memberId": member_id,
        "phone": normalized,
        "role": role,
        "status": "pending",
        "createdBy": caller.member_id,
        "createdAt": ts,
        "expiresAt": ts + INVITE_TTL_MS,
    })
    batch.commit()

    result = {"memberId": member_id, "inviteId": invite_id}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION)
def addAdmin(req: https_fn.CallableRequest) -> dict:
    role = (req.data or {}).get("role")
    if role not in ("chair", "treasurer", "secretary"):
        raise bad_request("role must be chair, treasurer, or secretary for addAdmin.")
    return _add_person(req, forced_role=role)


@https_fn.on_call(region=REGION)
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

@https_fn.on_call(region=REGION)
def completeProfile(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    phone = data.get("phone") or ""
    id_number = data.get("idNumber")
    chama_id = data.get("chamaId")

    if not is_valid_kenyan_phone(phone):
        raise bad_request("Enter a valid Kenyan phone number (07xx/01xx or +254...).")
    normalized = normalize_phone(phone)

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
        if id_number:
            id_last4, id_masked = mask_id_number(id_number)
            update.update({"idNumber": id_number.strip(), "idLast4": id_last4, "nationalIdMasked": id_masked})

        chama_snap = db.document(paths.chama(c_id)).get()
        chama_name = chama_snap.to_dict().get("name", "") if chama_snap.exists else ""

        batch = db.batch()
        batch.update(member_ref, update)
        batch.set(db.document(paths.user_chama_membership(uid, c_id)), {
            "chamaId": c_id,
            "chamaName": chama_name,
            "memberId": member_ref.id,
            "role": member["role"],
            "status": member.get("status", "active"),
            "updatedAt": ts,
        })
        batch.commit()
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


@https_fn.on_call(region=REGION)
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
    member_ref.update({"status": "removed", "removedAt": ts, "removedBy": uid, "updatedAt": ts})

    # Same membership-index sync updateMember does for a role/status change —
    # so a removed member's session immediately reflects they're out, rather
    # than waiting on the on_member_write trigger.
    if member.get("uid"):
        db.document(paths.user_chama_membership(member["uid"], chama_id)).set(
            {"status": "removed", "updatedAt": ts}, merge=True
        )

    result = {"ok": True}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result
