"""
One ID number, one member — per chama. Covers the lock registry (chamas/{id}/memberIdKeys/{idKey}) end to end
through every writer: addMember/addAdmin, createChama, completeProfile, removeMemberPermanently, updateMember
and the Desk import. The fake DB makes batch.create() atomic and AlreadyExists-raising like Firestore does.
"""
import inspect
import types

import pytest
from firebase_functions import https_fn

from fakes import FakeDB
from mychama import desk_delegate as dd
from mychama import identity
from shared import firestore_paths as paths
from shared.id_key import compute_id_key

PEPPER = "test-pepper-123"          # same value conftest.py binds as ID_PEPPER


def key(raw):
    return compute_id_key(raw, PEPPER)


def unwrap(fn):
    return inspect.unwrap(fn)


def req(data, uid="u1", token=None):
    return types.SimpleNamespace(auth=types.SimpleNamespace(uid=uid, token=token or {}), data=data)


def lock_path(chama_id, raw):
    return paths.member_id_key(chama_id, key(raw))


def locks(db):
    return [k for k in db.store if "/memberIdKeys/" in k]


def members(db, chama_id="c1"):
    return [k for k in db.store if k.startswith(f"chamas/{chama_id}/members/")]


@pytest.fixture
def db(monkeypatch):
    d = FakeDB({
        "chamas/c1": {"name": "Umoja", "plan": "starter", "status": "active"},
        "chamas/c1/members/chair": {
            "name": "Chair Person", "phone": "0712000001", "phoneNormalized": "+254712000001",
            "role": "chair", "status": "active", "uid": "u1",
        },
    })
    monkeypatch.setattr(identity, "_db", lambda: d)
    monkeypatch.setattr(identity, "require_finance_admin", lambda db_, uid, chama_id: types.SimpleNamespace(member_id="chair"))
    return d


def add(db, name, phone, idn, role=None):
    fn = unwrap(identity.addAdmin if role else identity.addMember)
    data = {"chamaId": "c1", "name": name, "phone": phone, "idNumber": idn}
    if role:
        data["role"] = role
    return fn(req(data))


# ------------------------------------------------------------------ addMember / addAdmin
def test_second_member_with_same_id_is_refused_even_when_formatted_differently(db):
    add(db, "Amina", "0722000001", "12345678")
    with pytest.raises(https_fn.HttpsError) as e:
        add(db, "Amina Again", "0722000002", "12 345-678")
    assert e.value.code == "already-exists" and "Amina" in e.value.message
    assert len(members(db)) == 2                                     # chair + Amina only
    assert len([k for k in db.store if k.startswith("chamas/c1/invites/")]) == 1


def test_the_new_member_carries_its_idkey_and_a_lock_pointing_at_it(db):
    out = add(db, "Amina", "0722000001", "12345678")
    doc = db.store[f"chamas/c1/members/{out['memberId']}"]
    assert doc["idKey"] == key("12345678")
    assert db.store[lock_path("c1", "12345678")]["memberId"] == out["memberId"]


def test_the_same_id_is_fine_in_a_different_chama(db):
    add(db, "Amina", "0722000001", "12345678")
    db.store["chamas/c2"] = {"name": "Other", "plan": "starter", "status": "active"}
    db.store["chamas/c2/members/chair2"] = {"phoneNormalized": "+254712000099", "status": "active", "role": "chair"}
    unwrap(identity.addMember)(req({"chamaId": "c2", "name": "Amina", "phone": "0722000001", "idNumber": "12345678"}))
    assert lock_path("c2", "12345678") in db.store


def test_an_inactive_member_still_holds_their_id_and_the_message_says_reactivate(db):
    out = add(db, "Amina", "0722000001", "12345678")
    db.store[f"chamas/c1/members/{out['memberId']}"]["status"] = "inactive"
    with pytest.raises(https_fn.HttpsError) as e:
        add(db, "Amina Back", "0733000001", "12345678")
    assert e.value.code == "already-exists" and "Reactivate" in e.value.message


def test_addadmin_is_covered_too(db):
    add(db, "Amina", "0722000001", "12345678")
    with pytest.raises(https_fn.HttpsError) as e:
        add(db, "Treasurer", "0722000009", "12345678", role="treasurer")
    assert e.value.code == "already-exists"


def test_lock_alone_blocks_when_the_holders_idkey_is_not_written_yet(db):
    # Trigger lag: the holder has the ID but no idKey yet, so the friendly pre-check cannot see it.
    db.store["chamas/c1/members/lag"] = {"name": "Lagging", "idNumber": "12345678", "status": "active", "role": "member"}
    db.store[lock_path("c1", "12345678")] = {"memberId": "lag", "createdAt": 1}
    with pytest.raises(https_fn.HttpsError) as e:
        add(db, "Newcomer", "0722000003", "12345678")
    assert e.value.code == "already-exists" and e.value.message == identity.DUPLICATE_ID_MESSAGE
    assert "chamas/c1/members/lag" in db.store and len(members(db)) == 2


def test_a_stray_lock_with_no_live_holder_does_not_block_the_id(db):
    db.store[lock_path("c1", "12345678")] = {"memberId": "ghost", "createdAt": 1}          # member doc long gone
    out = add(db, "Amina", "0722000001", "12345678")
    assert db.store[lock_path("c1", "12345678")]["memberId"] == out["memberId"]


def test_invalid_id_and_missing_pepper(db, monkeypatch):
    with pytest.raises(https_fn.HttpsError) as e:
        add(db, "Amina", "0722000001", "ab")
    assert e.value.code == "invalid-argument"
    monkeypatch.setattr(identity, "ID_PEPPER", types.SimpleNamespace(value=""))
    with pytest.raises(https_fn.HttpsError) as e:
        add(db, "Amina", "0722000001", "12345678")
    assert e.value.code == "internal"                                   # fails closed, writes nothing
    assert len(members(db)) == 1 and not locks(db)


# ------------------------------------------------------------------ removal and reactivation
def test_permanent_removal_releases_the_id_for_a_new_member(db):
    out = add(db, "Amina", "0722000001", "12345678")
    unwrap(identity.removeMemberPermanently)(req({"chamaId": "c1", "memberId": out["memberId"]}))
    assert db.store[f"chamas/c1/members/{out['memberId']}"]["status"] == "removed"
    assert lock_path("c1", "12345678") not in db.store
    again = add(db, "Amina New", "0744000001", "12345678")
    assert db.store[lock_path("c1", "12345678")]["memberId"] == again["memberId"]


def test_a_removed_member_cannot_be_resurrected_into_a_duplicate(db, monkeypatch):
    out = add(db, "Amina", "0722000001", "12345678")
    unwrap(identity.removeMemberPermanently)(req({"chamaId": "c1", "memberId": out["memberId"]}))
    add(db, "Amina New", "0744000001", "12345678")
    monkeypatch.setattr(identity, "require_membership", lambda db_, uid, chama_id: types.SimpleNamespace(is_finance_admin=True))
    with pytest.raises(https_fn.HttpsError) as e:
        unwrap(identity.updateMember)(req({"chamaId": "c1", "memberId": out["memberId"], "patch": {"status": "active"}}))
    assert e.value.code == "failed-precondition"


# ------------------------------------------------------------------ createChama
def test_create_chama_takes_the_chairs_lock(db, monkeypatch):
    monkeypatch.setattr(identity, "assign_public_code", lambda txn, d, ref: "SMC-0001")
    token = {"email": "a@b.co", "email_verified": True}
    out = unwrap(identity.createChama)(req({
        "name": "New Chama", "contributionAmount": 500, "contributionCycle": "monthly",
        "adminName": "Founder", "adminPhone": "0755000001", "adminIdNumber": "87654321",
    }, uid="u9", token=token))
    assert db.store[lock_path(out["chamaId"], "87654321")]["memberId"] == out["memberId"]
    assert db.store[f"chamas/{out['chamaId']}/members/{out['memberId']}"]["idKey"] == key("87654321")


# ------------------------------------------------------------------ completeProfile
def pending_member(db, member_id, phone_norm, idn=None, chama="c1"):
    doc = {"name": member_id, "phone": phone_norm, "phoneNormalized": phone_norm, "role": "member",
           "status": "active", "uid": None}
    if idn:
        doc.update({"idNumber": idn, "idKey": key(idn)})
        db.store[lock_path(chama, idn)] = {"memberId": member_id, "createdAt": 1}
    db.store[f"chamas/{chama}/members/{member_id}"] = doc


def test_complete_profile_moves_the_lock_when_the_id_changes(db):
    pending_member(db, "m2", "+254766000001", idn="11111111")
    unwrap(identity.completeProfile)(req({"phone": "0766000001", "idNumber": "22222222", "chamaId": "c1"}, uid="u2"))
    assert lock_path("c1", "11111111") not in db.store
    assert db.store[lock_path("c1", "22222222")]["memberId"] == "m2"
    doc = db.store["chamas/c1/members/m2"]
    assert doc["uid"] == "u2" and doc["idKey"] == key("22222222")


def test_complete_profile_refuses_an_id_another_member_holds_without_naming_them(db):
    pending_member(db, "m1", "+254766000002", idn="33333333")
    pending_member(db, "m2", "+254766000003", idn="44444444")
    with pytest.raises(https_fn.HttpsError) as e:
        unwrap(identity.completeProfile)(req({"phone": "0766000003", "idNumber": "33333333", "chamaId": "c1"}, uid="u2"))
    assert e.value.code == "already-exists" and e.value.message == identity.DUPLICATE_ID_SELF_MESSAGE
    assert "m1" not in e.value.message
    assert db.store["chamas/c1/members/m2"]["uid"] is None                      # nothing was written
    assert db.store[lock_path("c1", "44444444")]["memberId"] == "m2"


def test_complete_profile_without_an_id_change_touches_no_lock(db):
    pending_member(db, "m2", "+254766000004", idn="55555555")
    unwrap(identity.completeProfile)(req({"phone": "0766000004", "idNumber": "55 555-555", "chamaId": "c1"}, uid="u2"))
    assert db.store[lock_path("c1", "55555555")]["memberId"] == "m2" and len(locks(db)) == 1


# ------------------------------------------------------------------ Desk import
def desk_db():
    return FakeDB({
        "publicCodes/SMC-0001": {"chamaId": "c1"},
        "chamas/c1": {"name": "Umoja", "publicCode": "SMC-0001", "plan": "starter", "smsCredits": 100,
                      "supportAgents": {"COG-0007": {"addedAt": 5, "addedBy": "m1"}}},
        "chamas/c1/members/m1": {"name": "Chair", "phoneNormalized": "+254712000001", "role": "chair",
                                 "status": "active", "idNumber": "99999999"},
    })


def call(db, action, payload, rid="req-00000001"):
    return dd.handle(db, {"action": action, "entityCode": "SMC-0001", "agentCode": "COG-0007", "requestId": rid, "payload": payload})


def test_desk_validation_flags_duplicate_ids_in_the_file_and_against_existing_members(db):
    rows = [
        {"name": "A", "phone": "0722000001", "idNumber": "12345678"},
        {"name": "B", "phone": "0722000002", "idNumber": "12 345-678"},       # same ID as A, different phone
        {"name": "C", "phone": "0722000003", "idNumber": "99999999"},         # the chair's ID
        {"name": "D", "phone": "0722000004", "idNumber": "22345678"},
    ]
    _, resp = call(desk_db(), "validate_records", {"rows": rows})
    res = resp["result"]
    assert [v["name"] for v in res["valid"]] == ["A", "D"]
    assert {(e["row"], e["field"]) for e in res["errors"]} == {(2, "idNumber"), (3, "idNumber")}


def test_desk_commit_takes_a_lock_per_member_and_blocks_a_second_import(db):
    d = desk_db()
    rows = [{"name": "A", "phone": "0722000001", "idNumber": "12345678"}]
    _, first = call(d, "commit_records", {"rows": rows, "source": "excel"}, rid="commit-0001")
    assert first["result"]["created"] == 1 and lock_path("c1", "12345678") in d.store
    again = [{"name": "A2", "phone": "0722000077", "idNumber": "12345678"}]
    _, second = call(d, "commit_records", {"rows": again, "source": "excel"}, rid="commit-0002")
    assert second["result"]["created"] == 0 and second["result"]["errors"][0]["field"] == "idNumber"
