#!/usr/bin/env python3
"""
One-off, idempotent backfill of the per-chama ID-number locks (chamas/{chamaId}/memberIdKeys/{idKey}) for
members that existed before one-ID-one-member was enforced.

    export GOOGLE_CLOUD_PROJECT=mychama1          # runs with Application Default Credentials
    export MYCHAMA_ID_PEPPER='<same value as the Secret Manager secret>'
    python tools/backfill_member_id_locks.py            # DRY RUN (default): reports only
    python tools/backfill_member_id_locks.py --apply    # creates the missing locks

What it does, per chama, over every member that is not 'removed':
  - one member holds an ID            -> make sure its lock exists (created with create(), never overwritten)
  - two or more members share an ID   -> REPORTED, never auto-resolved and never locked. Fix those by hand
                                         (remove or correct the extra member), then re-run.
  - a lock already held by someone else -> reported as a conflict.

Exit code 3 when duplicate groups or conflicts remain, so a script or CI step notices. Safe to re-run.
Never prints ID numbers or keys: only counts, chama ids, member ids, role and status.
"""
import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "functions"))

import firebase_admin  # noqa: E402
from firebase_admin import firestore  # noqa: E402
from google.api_core import exceptions as gexc  # noqa: E402

from shared import firestore_paths as paths  # noqa: E402
from shared.dates import now_ms  # noqa: E402
from shared.id_key import compute_id_key  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually create the locks (default is a dry run)")
    args = ap.parse_args()

    pepper = os.environ.get("MYCHAMA_ID_PEPPER", "")
    if not pepper:
        print("MYCHAMA_ID_PEPPER is not set", file=sys.stderr)
        return 2

    firebase_admin.initialize_app()
    db = firestore.client()

    # (chamaId, idKey) -> [(memberId, role, status)]
    groups: dict[tuple[str, str], list[tuple[str, str, str]]] = defaultdict(list)
    seen = no_id = removed = 0
    for snap in db.collection_group(paths.MC.MEMBERS).stream():
        seen += 1
        data = snap.to_dict() or {}
        if data.get("status") == "removed":
            removed += 1
            continue
        key = compute_id_key(data.get("idNumber") or "", pepper)
        if not key:
            no_id += 1
            continue
        chama_id = snap.reference.parent.parent.id
        groups[(chama_id, key)].append((snap.id, str(data.get("role") or "?"), str(data.get("status") or "?")))

    unique = created = already = conflicts = 0
    duplicate_groups: list[tuple[str, list[tuple[str, str, str]]]] = []
    conflict_groups: list[tuple[str, str]] = []
    for (chama_id, key), members in groups.items():
        if len(members) > 1:
            duplicate_groups.append((chama_id, members))
            continue
        unique += 1
        member_id = members[0][0]
        ref = db.document(paths.member_id_key(chama_id, key))
        lock = ref.get()
        if lock.exists:
            if (lock.to_dict() or {}).get("memberId") == member_id:
                already += 1
            else:
                conflicts += 1
                conflict_groups.append((chama_id, member_id))
            continue
        if args.apply:
            try:
                ref.create({"memberId": member_id, "createdAt": now_ms()})
                created += 1
            except gexc.AlreadyExists:
                already += 1          # the live code path created it between our read and write
        else:
            created += 1              # dry run: would create

    mode = "APPLIED" if args.apply else "DRY RUN"
    verb = "created" if args.apply else "would create"
    print(f"[{mode}] members seen={seen} removed={removed} without an ID={no_id} unique IDs={unique}")
    print(f"[{mode}] locks {verb}={created} already in place={already} held by a different member={conflicts}")
    if duplicate_groups:
        print(f"\n{len(duplicate_groups)} duplicate group(s) — two or more members share one ID. Resolve by hand, then re-run:")
        for chama_id, members in duplicate_groups:
            detail = ", ".join(f"{mid} ({role}, {status})" for mid, role, status in members)
            print(f"  chamas/{chama_id}/members: {detail}")
    if conflict_groups:
        print(f"\n{len(conflict_groups)} member(s) whose ID lock is held by a different member:")
        for chama_id, member_id in conflict_groups:
            print(f"  chamas/{chama_id}/members/{member_id}")
    return 3 if (duplicate_groups or conflict_groups) else 0


if __name__ == "__main__":
    raise SystemExit(main())
