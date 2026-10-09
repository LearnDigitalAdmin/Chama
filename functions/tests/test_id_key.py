"""
Checks for shared/id_key.py. The vectors below are the CROSS-LANGUAGE contract:
PAY's functions/src/mychama/config.ts (computeIdKey) must produce the same hex
for the same pepper — PAY's docs/mychama/track-A-notes.md lists the same set.

Run:  python functions/tests/test_id_key.py   (exit code 1 on failure)
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from shared.id_key import compute_id_key, normalize_id_number

PEPPER = "test-pepper-123"
VECTORS = [
    ("12345678",    "12345678", "5f2b4873088e9d4ee7cb39de1b6f4723ba83bed014d882f445fc4b1e4a487d92"),
    ("12 345-678",  "12345678", "5f2b4873088e9d4ee7cb39de1b6f4723ba83bed014d882f445fc4b1e4a487d92"),
    ("a1234567",    "A1234567", "cc0d2069f3bb9ab2a64e6766739737d4c8cb6352e158ee4eebbc14cf8a342fdc"),
    (" 0012.3456 ", "00123456", "d3286373afc9a2dde04e1ed56437c3088b820d5d2d2bab9c48459139b5a8b896"),
    ("K-1234 567",  "K1234567", "8a11729bb5c2011f3ac0d43820ee9fc3995e567c5d8614ca7c154910af94ae21"),
    ("",            "",         ""),
    ("!!!",         "",         ""),
]

failures = []
for raw, norm, key in VECTORS:
    if normalize_id_number(raw) != norm:
        failures.append(f"normalize {raw!r}: got {normalize_id_number(raw)!r}, want {norm!r}")
    if compute_id_key(raw, PEPPER) != key:
        failures.append(f"key {raw!r}: mismatch")

if compute_id_key("12345678", "") != "":
    failures.append("empty pepper must yield empty key")
if compute_id_key("12345678", "other-pepper") == compute_id_key("12345678", PEPPER):
    failures.append("different peppers must yield different keys")

if failures:
    print("FAIL")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print(f"OK — {len(VECTORS)} vectors, pepper-sensitivity and empty-input cases pass")
