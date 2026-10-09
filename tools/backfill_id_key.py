#!/usr/bin/env python3
"""
One-off, idempotent backfill of members.idKey for members that existed before
the on_member_id_key trigger was deployed.

    export GOOGLE_CLOUD_PROJECT=mychama1          # runs with Application Default Credentials
    export MYCHAMA_ID_PEPPER='<same value as the Secret Manager secret>'
    python tools/backfill_id_key.py            # DRY RUN (default): counts only
    python tools/backfill_id_key.py --apply    # writes, in batches

Safe to re-run: members whose idKey already matches are skipped. Never prints
ID numbers or keys — only counts.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "functions"))

import firebase_admin  # noqa: E402
from firebase_admin import firestore  # noqa: E402

from shared.id_key import compute_id_key  # noqa: E402

BATCH = 400


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    args = ap.parse_args()

    pepper = os.environ.get("MYCHAMA_ID_PEPPER", "")
    if not pepper:
        print("MYCHAMA_ID_PEPPER is not set", file=sys.stderr)
        return 2

    firebase_admin.initialize_app()
    db = firestore.client()

    seen = need = no_id = 0
    batch = db.batch()
    pending = 0
    for snap in db.collection_group("members").stream():
        seen += 1
        data = snap.to_dict() or {}
        want = compute_id_key(data.get("idNumber") or "", pepper)
        have = data.get("idKey") or ""
        if not want and not have:
            no_id += 1
            continue
        if want == have:
            continue
        need += 1
        if args.apply:
            batch.update(snap.reference, {"idKey": want if want else firestore.DELETE_FIELD})
            pending += 1
            if pending >= BATCH:
                batch.commit()
                batch = db.batch()
                pending = 0
    if args.apply and pending:
        batch.commit()

    mode = "APPLIED" if args.apply else "DRY RUN"
    print(f"[{mode}] members seen={seen} needing idKey={need} without an ID={no_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
