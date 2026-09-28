"""
Self-contained checks for the reports engine's money-critical logic:
the credit/wallet/à-la-carte gate (spend_credits, consume_alacarte_purchase)
and period-preset resolution, including year/quarter boundaries and leap
years. No Firestore or emulator needed — the transaction layer is faked.

Run:  python functions/tests/test_reports_credit_gate.py   (exit code 1 on failure)
"""
import os, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import shared.reports_engine as engine
from firebase_functions import https_fn

# ---- fake Firestore transaction layer -------------------------------------
class Snap:
    def __init__(s, d): s._d = d
    @property
    def exists(s): return s._d is not None
    def to_dict(s): return dict(s._d)
class Ref:
    def __init__(s, store, key): s.store, s.key = store, key
    def get(s, transaction=None): return Snap(s.store.get(s.key))
class Txn:
    def update(s, ref, data): ref.store[ref.key].update(data)
class DB:
    def __init__(s, store): s.store = store
    def transaction(s): return Txn()
    def document(s, path): return Ref(s.store, path)
engine.firestore = types.SimpleNamespace(transactional=lambda f: f)

def chama(plan, **kw):
    store = {"c": {"plan": plan, **kw}}
    return DB(store), Ref(store, "c"), store

def code(fn):
    try: fn(); return "OK"
    except https_fn.HttpsError as e: return e.code.value if hasattr(e.code,'value') else str(e.code)

def check(name, got, want):
    print(("PASS " if got == want else "FAIL ") + name, "" if got == want else f"(got {got!r}, want {want!r})")
    return got == want

ok = True
# Starter: 3 standard credits, no wallet
db, ref, st = chama("starter")
for i in range(3): ok &= check(f"starter ledger #{i+1}", code(lambda: engine.spend_credits(db, ref, st["c"], "contribution_ledger")), "OK")
ok &= check("starter 4th ledger, empty wallet -> resource-exhausted", code(lambda: engine.spend_credits(db, ref, st["c"], "contribution_ledger")), "resource-exhausted")
ok &= check("starter used counter", st["c"]["standardReportsUsedThisMonth"], 3)

# Starter with wallet 3: allowance spent, then wallet pays; arrears costs 2
db, ref, st = chama("starter", standardReportsUsedThisMonth=3, reportCreditsBalance=3)
r = engine.spend_credits(db, ref, st["c"], "arrears_penalties")
ok &= check("wallet pays arrears (2)", (r["source"], st["c"]["reportCreditsBalance"]), ("wallet", 1))
ok &= check("wallet 1 < arrears 2 -> exhausted", code(lambda: engine.spend_credits(db, ref, st["c"], "arrears_penalties")), "resource-exhausted")

# Legacy field fallback: old chama with minutesExportsUsedThisMonth=3 is exhausted
db, ref, st = chama("starter", minutesExportsUsedThisMonth=3)
ok &= check("legacy counter respected", code(lambda: engine.spend_credits(db, ref, st["c"], "contribution_ledger")), "resource-exhausted")

# Premium blocked below Growth even with a huge wallet
db, ref, st = chama("basic", reportCreditsBalance=100)
ok &= check("basic + premium + wallet -> failed-precondition", code(lambda: engine.spend_credits(db, ref, st["c"], "balance_sheet")), "failed-precondition")
db, ref, st = chama("free", reportCreditsBalance=100)
ok &= check("free -> failed-precondition", code(lambda: engine.spend_credits(db, ref, st["c"], "contribution_ledger")), "failed-precondition")

# Growth: standard unlimited & uncharged wallet; premium 4 allowance
db, ref, st = chama("growth", reportCreditsBalance=5)
for i in range(5): engine.spend_credits(db, ref, st["c"], "contribution_ledger")
ok &= check("growth standard unlimited, wallet untouched", st["c"]["reportCreditsBalance"], 5)
engine.spend_credits(db, ref, st["c"], "profit_loss")           # 3 of 4
ok &= check("growth P&L uses allowance", st["c"]["premiumReportsUsedThisMonth"], 3)
r = engine.spend_credits(db, ref, st["c"], "profit_loss")       # 3+3>4 -> wallet
ok &= check("growth 2nd P&L falls to wallet", (r["source"], st["c"]["reportCreditsBalance"]), ("wallet", 2))
ok &= check("growth 3rd P&L, wallet 2<3 -> exhausted", code(lambda: engine.spend_credits(db, ref, st["c"], "profit_loss")), "resource-exhausted")

# Max: cashflow (2) x5 fits in 10
db, ref, st = chama("max")
for i in range(5): engine.spend_credits(db, ref, st["c"], "cashflow")
ok &= check("max 5 cashflows = 10 credits", st["c"]["premiumReportsUsedThisMonth"], 10)
ok &= check("max 6th -> exhausted", code(lambda: engine.spend_credits(db, ref, st["c"], "cashflow")), "resource-exhausted")

# À la carte consumption
p = "chamas/x/reportAlacartePurchases/MCR-1"
store = {}
import shared.firestore_paths as paths
key = paths.report_alacarte_purchase("x", "MCR-1")
store[key] = {"status": "success", "reportType": "balance_sheet", "dateFrom": None}
db = DB(store)
ok &= check("consume ok", code(lambda: engine.consume_alacarte_purchase(db, "x", "balance_sheet", "MCR-1")), "OK")
ok &= check("now consumed", store[key]["status"], "consumed")
ok &= check("double-consume blocked", code(lambda: engine.consume_alacarte_purchase(db, "x", "balance_sheet", "MCR-1")), "failed-precondition")
store[key] = {"status": "pending", "reportType": "balance_sheet"}
ok &= check("pending blocked", code(lambda: engine.consume_alacarte_purchase(db, "x", "balance_sheet", "MCR-1")), "failed-precondition")
store[key] = {"status": "success", "reportType": "cashflow"}
ok &= check("wrong report type blocked", code(lambda: engine.consume_alacarte_purchase(db, "x", "balance_sheet", "MCR-1")), "invalid-argument")
ok &= check("unknown reference", code(lambda: engine.consume_alacarte_purchase(db, "x", "balance_sheet", "NOPE")), "not-found")

# ---- period edge cases with a frozen clock --------------------------------
import datetime as _dt
def frozen(y, m, d):
    class F(_dt.datetime):
        @classmethod
        def now(cls, tz=None): return cls(y, m, d, tzinfo=tz)
    return F
orig = engine.datetime
engine.datetime = frozen(2026, 1, 15)
ok &= check("Jan: last_quarter", engine.resolve_range("last_quarter", None, None), ("2025-10-01", "2025-12-31"))
ok &= check("Jan: this_quarter", engine.resolve_range("this_quarter", None, None), ("2026-01-01", "2026-03-31"))
ok &= check("Jan: last_month", engine.resolve_range("last_month", None, None), ("2025-12-01", "2025-12-31"))
ok &= check("Jan: this_fy(Jul start)", engine.resolve_range("this_fy", None, None, 7), ("2025-07-01", "2026-06-30"))
ok &= check("Jan: last_fy(Jul start)", engine.resolve_range("last_fy", None, None, 7), ("2024-07-01", "2025-06-30"))
engine.datetime = frozen(2026, 12, 31)
ok &= check("Dec31: this_quarter", engine.resolve_range("this_quarter", None, None), ("2026-10-01", "2026-12-31"))
ok &= check("Dec31: this_fy(Jan)", engine.resolve_range("this_fy", None, None, 1), ("2026-01-01", "2026-12-31"))
engine.datetime = frozen(2028, 3, 1)  # leap year
ok &= check("leap Feb via last_month", engine.resolve_range("last_month", None, None), ("2028-02-01", "2028-02-29"))
ok &= check("as_of last_quarter = its end", engine.resolve_as_of("last_quarter", None), "2027-12-31")
engine.datetime = orig
ok &= check("custom needs both dates", code(lambda: engine.resolve_range("custom", "2026-01-01", None)), "failed-precondition")
ok &= check("unknown preset", code(lambda: engine.resolve_range("nonsense", None, None)), "failed-precondition")

print("\nALL PASSED" if ok else "\nSOME FAILED")
sys.exit(0 if ok else 1)
