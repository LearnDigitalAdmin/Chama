"""
on_member_write — keeps userChamas/{uid}/memberships/{chamaId} in sync with
chamas/{chamaId}/members/{memberId} any time a member document changes.

The identity callables (mychama/identity.py) already write this index
directly on the paths they control, so in the common case this trigger is a
no-op safety net. It exists so that:
  - a manual/console edit to a members doc,
  - a future callable that forgets to touch the index,
  - or a member being deleted outright,
can never leave userChamas stale — every authorisation check in
functions/shared/roles.py and every firestore.rules rule reads ONLY the
userChamas index, never the members doc directly, so staleness here is a
security bug, not just a UI bug.
"""

from __future__ import annotations

from firebase_functions import firestore_fn
from firebase_admin import firestore

from shared import firestore_paths as paths
from shared.dates import now_ms

REGION = "africa-south1"


@firestore_fn.on_document_written(
    document=f"{paths.MC.CHAMAS}/{{chamaId}}/{paths.MC.MEMBERS}/{{memberId}}",
    region=REGION,
)
def on_member_write(event: firestore_fn.Event[firestore_fn.Change]) -> None:
    chama_id = event.params["chamaId"]
    db = firestore.client()

    after = event.data.after
    before = event.data.before
    ts = now_ms()

    # Deleted — remove the membership index entry for whichever uid it had.
    if after is None or not after.exists:
        old = before.to_dict() if before and before.exists else None
        old_uid = old.get("uid") if old else None
        if old_uid:
            db.document(paths.user_chama_membership(old_uid, chama_id)).delete()
        return

    member = after.to_dict()
    uid = member.get("uid")

    # No linked auth account yet (still pending an invite claim) — nothing
    # to index. If a previous version HAD a uid and it was cleared, clean
    # up that stale entry.
    if not uid:
        old = before.to_dict() if before and before.exists else None
        old_uid = old.get("uid") if old else None
        if old_uid:
            db.document(paths.user_chama_membership(old_uid, chama_id)).delete()
        return

    chama_snap = db.document(paths.chama(chama_id)).get()
    chama_name = chama_snap.to_dict().get("name", "") if chama_snap.exists else ""

    db.document(paths.user_chama_membership(uid, chama_id)).set({
        "chamaId": chama_id,
        "chamaName": chama_name,
        "memberId": after.id,
        "role": member.get("role", "member"),
        "status": member.get("status", "active"),
        "updatedAt": ts,
    })
