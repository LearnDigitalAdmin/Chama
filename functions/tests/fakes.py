"""
In-memory stand-ins for Firestore, used ONLY by tests. They implement just the calls MyChama's desk code makes.
Transactions are applied immediately (no isolation) — enough to check logic, not Firestore's concurrency.
"""
from __future__ import annotations

import re
from typing import Any

from firebase_admin import firestore as real_fs

_SENT = real_fs.DELETE_FIELD


def _split_path(path: str) -> list[str]:
    parts, buf, quoted = [], "", False
    for ch in path:
        if ch == "`":
            quoted = not quoted
        elif ch == "." and not quoted:
            parts.append(buf)
            buf = ""
        else:
            buf += ch
    parts.append(buf)
    return parts


class Snap:
    def __init__(self, ref: "Ref", data: dict | None):
        self.reference, self.id, self._d = ref, ref.id, data

    @property
    def exists(self) -> bool:
        return self._d is not None

    def to_dict(self) -> dict | None:
        import copy
        return copy.deepcopy(self._d) if self._d is not None else None


class Ref:
    def __init__(self, db: "FakeDB", path: str):
        self.db, self.path = db, path
        self.id = path.rsplit("/", 1)[-1]

    @property
    def parent(self):
        return Coll(self.db, self.path.rsplit("/", 1)[0])

    def get(self, transaction=None) -> Snap:
        return Snap(self, self.db.store.get(self.path))

    def set(self, data: dict, merge: bool = False) -> None:
        import copy
        self.db.store[self.path] = copy.deepcopy(data)

    def update(self, changes: dict) -> None:
        cur = self.db.store.get(self.path)
        if cur is None:
            raise KeyError(f"update on missing document {self.path}")
        for key, val in changes.items():
            *head, last = _split_path(key)
            node = cur
            for h in head:
                node = node.setdefault(h, {})
            if val is _SENT:
                node.pop(last, None)
            elif type(val).__name__ == "Increment":
                node[last] = node.get(last, 0) + val.value
            else:
                node[last] = val

    def delete(self) -> None:
        self.db.store.pop(self.path, None)


class Query:
    def __init__(self, db, coll_path, filters=(), order=None, lim=None):
        self.db, self.coll, self.filters, self.order, self.lim = db, coll_path, tuple(filters), order, lim

    def where(self, field, op, value):
        return Query(self.db, self.coll, self.filters + ((field, op, value),), self.order, self.lim)

    def order_by(self, field, direction=None):
        return Query(self.db, self.coll, self.filters, (field, direction), self.lim)

    def limit(self, n):
        return Query(self.db, self.coll, self.filters, self.order, n)

    def stream(self):
        out = []
        pat = re.compile("^" + re.escape(self.coll) + "/([^/]+)$")
        for path, data in list(self.db.store.items()):
            if not pat.match(path):
                continue
            ok = True
            for f, op, v in self.filters:
                x = data.get(f)
                ok &= {"==": x == v, "<=": x is not None and x <= v, "in": x in v}[op]
            if ok:
                out.append(Snap(Ref(self.db, path), data))
        if self.order:
            f, d = self.order
            out.sort(key=lambda s: s._d.get(f, 0), reverse=bool(d) and "DESC" in str(d).upper())
        return iter(out[: self.lim] if self.lim else out)


class Coll(Query):
    def __init__(self, db, path):
        super().__init__(db, path)
        self.path = path

    def document(self, doc_id: str | None = None) -> Ref:
        self.db.n += 1
        return Ref(self.db, f"{self.path}/{doc_id or f'auto{self.db.n:05d}'}")


class Batch:
    def __init__(self):
        self.ops: list = []

    def set(self, ref, data):
        self.ops.append((ref, data))

    def commit(self):
        for ref, data in self.ops:
            ref.set(data)


class Txn:
    def set(self, ref, data):
        ref.set(data)

    def update(self, ref, changes):
        ref.update(changes)


class FakeDB:
    def __init__(self, store: dict[str, dict] | None = None):
        self.store: dict[str, Any] = store if store is not None else {}
        self.n = 0

    def document(self, path):
        return Ref(self, path)

    def collection(self, path):
        return Coll(self, path)

    def batch(self):
        return Batch()

    def transaction(self):
        return Txn()
