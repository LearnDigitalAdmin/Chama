"""
NEW — required by offline support (see docs/OFFLINE.md).

src/lib/offlineQueue.ts queues money-moving callables while the device is
offline and replays them on reconnect. A replay can legitimately happen
twice for the same logical action — e.g. the server actually applied it,
but the client lost its connection before the response arrived, so the
queue (correctly) doesn't know it succeeded and retries once back online.
Every callable that mutates money or pot state MUST be idempotent against
this by calling `check_and_record` at the very top, before any other write.

Usage:
    from shared.idempotency import check_and_record

    @https_fn.on_call(region=REGION)
    def recordCashContribution(req):
        ...
        dedup = check_and_record(db, chama_id, data.get("clientRequestId"), lambda: {"ok": True, "status": ...})
        if dedup is not None:
            return dedup
        ... do the real work, then record the result ...

Simpler pattern actually used in this codebase: call `already_applied()`
early to check-and-reserve the key, do the work, then `record_result()`
with the final response so a replay returns the SAME response without
re-running any of the money logic.
"""

from __future__ import annotations

from firebase_admin import firestore

from . import firestore_paths as paths
from .dates import now_ms

IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000  # 7 days — matches the client queue's cleanup window


def _ref(db, chama_id: str, client_request_id: str):
    return db.document(f"{paths.chama(chama_id)}/idempotencyKeys/{client_request_id}")


def already_applied(db, chama_id: str, client_request_id: str | None) -> dict | None:
    """
    Call this FIRST, before any other read or write. If this exact action
    was already recorded (a replay), returns the ORIGINAL response — the
    caller must return it immediately without redoing any work. If this is
    the first time (or no clientRequestId was supplied, e.g. a normal
    online call), returns None and reserves the key by writing a
    'pending' placeholder, so a concurrent double-submit (e.g. a double
    button tap that races the offline queue) can't both proceed either.
    """
    if not client_request_id:
        return None

    ref = _ref(db, chama_id, client_request_id)

    @firestore.transactional
    def _txn(transaction: firestore.Transaction):
        snap = ref.get(transaction=transaction)
        if snap.exists:
            data = snap.to_dict()
            if data.get("status") == "done":
                return data.get("result")
            # status == 'pending' means another request with the same key is
            # mid-flight right now (a genuine race, not an offline replay) —
            # treat as a duplicate submission and refuse rather than run twice.
            return {"__duplicate_in_flight__": True}
        transaction.set(ref, {"status": "pending", "createdAt": now_ms()})
        return None

    result = _txn(db.transaction())
    if result is not None and result.get("__duplicate_in_flight__"):
        from .errors import precondition
        raise precondition("This action is already being processed. Please wait a moment.")
    return result


def record_result(db, chama_id: str, client_request_id: str | None, result: dict) -> None:
    """Call this LAST, right before returning, with the exact response you're
    about to send back — a replay will receive this same object verbatim."""
    if not client_request_id:
        return
    _ref(db, chama_id, client_request_id).set({
        "status": "done",
        "result": result,
        "createdAt": now_ms(),
        "expiresAt": now_ms() + IDEMPOTENCY_TTL_MS,
    })
