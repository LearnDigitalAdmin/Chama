"""
on_member_id_key — keeps members.idKey (see shared/id_key.py) in step with
members.idNumber. A dedicated trigger rather than call-site changes because
more than one writer creates members (the app's callables, the WhatsApp bot,
manual console edits) and every one of them must end up keyed.

Loop-safe: it only writes when the computed key differs from the stored one,
so the write it makes re-triggers it exactly once and that second run is a
no-op. It never logs the ID number or the key.
"""

from __future__ import annotations

from firebase_functions import firestore_fn
from firebase_admin import firestore

from shared import firestore_paths as paths
from shared.id_key import compute_id_key
from shared.secrets import ID_PEPPER

REGION = "africa-south1"


@firestore_fn.on_document_written(
    document=f"{paths.MC.CHAMAS}/{{chamaId}}/{paths.MC.MEMBERS}/{{memberId}}",
    region=REGION,
    secrets=[ID_PEPPER],
)
def on_member_id_key(event: firestore_fn.Event[firestore_fn.Change]) -> None:
    after = event.data.after
    if after is None or not after.exists:
        return  # deleted — nothing to key

    data = after.to_dict() or {}
    want = compute_id_key(data.get("idNumber") or "", ID_PEPPER.value)
    have = data.get("idKey") or ""
    if want == have:
        return

    after.reference.update({"idKey": want if want else firestore.DELETE_FIELD})
