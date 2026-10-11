#!/usr/bin/env python3
"""
One-off, idempotent backfill of publicCode (SMC-0001 …) for chamas created before codes existed.

    export GOOGLE_CLOUD_PROJECT=mychama1          # Application Default Credentials
    python tools/backfill_public_codes.py            # DRY RUN (default): counts only
    python tools/backfill_public_codes.py --apply    # assigns codes, oldest chama first

Each chama is stamped in its own transaction that bumps the atomic counter and reserves publicCodes/{code}
(create-only), so codes are unique even if createChama runs at the same time and a re-run skips chamas that
already have one. Chama document IDs are never touched. Prints counts only.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "functions"))

import firebase_admin  # noqa: E402
from firebase_admin import firestore  # noqa: E402

from shared.desk_codes import allocate_for_existing_chama  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    args = ap.parse_args()
    firebase_admin.initialize_app()
    db = firestore.client()

    pending = [d.id for d in db.collection("chamas").order_by("createdAt").stream() if not (d.to_dict() or {}).get("publicCode")]
    print(f"{len(pending)} chama(s) without a publicCode")
    if not args.apply:
        print("dry run — pass --apply to assign codes")
        return 0
    done = 0
    for chama_id in pending:
        allocate_for_existing_chama(db, chama_id)
        done += 1
    print(f"assigned {done} code(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
