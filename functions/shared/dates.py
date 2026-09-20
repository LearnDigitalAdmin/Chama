"""
Date helpers — MUST mirror CYBER/functions/src/services/mychama.service.ts
(todayISO, addDaysISO, fmtDate, periodKeyOf) and src/lib/dates.ts.

Calendar-day fields (paidOn, requestedOn, dueDate, joinDate, date) are ISO
date strings 'YYYY-MM-DD' — string-sortable, which every range query in
firestore.indexes.json relies on. Do not switch these to Firestore
Timestamps without rewriting the indexes.

createdAt / updatedAt are epoch MILLISECONDS (int), not Timestamps, to match
the WhatsApp bot's session clock and allow cheap numeric range filters.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone


def today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def add_days_iso(days: int, base: datetime | None = None) -> str:
    d = (base or datetime.now(timezone.utc)) + timedelta(days=days)
    return d.strftime("%Y-%m-%d")


def period_key_of(date: datetime | None = None) -> str:
    """Human month key used to sort contribution periods reliably: YYYY-MM."""
    d = date or datetime.now(timezone.utc)
    return d.strftime("%Y-%m")


def now_ms() -> int:
    """Epoch milliseconds — matches Date.now() in the TypeScript codebases."""
    return int(time.time() * 1000)


def now_seconds() -> int:
    """Epoch seconds — matches the bot's `now()` helper for lockout windows."""
    return int(time.time())
