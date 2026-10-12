import os, sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def _id_pepper(monkeypatch):
    """Member writes derive an ID-uniqueness lock from the pepper and refuse to run without one."""
    import types
    from mychama import identity
    monkeypatch.setattr(identity, "ID_PEPPER", types.SimpleNamespace(value="test-pepper-123"))


@pytest.fixture(autouse=True)
def _plain_transactions(monkeypatch):
    """The fake DB applies writes immediately, so @firestore.transactional becomes a pass-through."""
    from firebase_admin import firestore
    monkeypatch.setattr(firestore, "transactional", lambda f: f)
