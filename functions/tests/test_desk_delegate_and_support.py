import inspect
import pytest
from firebase_functions import https_fn

from fakes import FakeDB
from mychama import desk_delegate as dd
from mychama import desk_support as ds
from mychama import identity, reports, sms
from shared import reports_engine as engine


def unwrap(fn):
    return inspect.unwrap(fn)


def base_db(plan="starter", credits=100, agents=None, extra=None):
    store = {
        "publicCodes/SMC-0001": {"chamaId": "c1"},
        "chamas/c1": {"name": "Umoja", "publicCode": "SMC-0001", "plan": plan, "smsCredits": credits,
                      "supportAgents": agents if agents is not None else {"COG-0007": {"addedAt": 5, "addedBy": "m1"}}},
        "chamas/c1/members/m1": {"name": "Chair Person", "phone": "0712000001", "phoneNormalized": "+254712000001",
                                 "role": "chair", "status": "active", "isAdmin": True},
        **(extra or {}),
    }
    return FakeDB(store)


def call(db, action, payload, agent="COG-0007", rid="req-00000001", entity="SMC-0001"):
    return dd.handle(db, {"action": action, "entityCode": entity, "agentCode": agent, "requestId": rid, "payload": payload})


# ---------------------------------------------------------------- request gate
@pytest.mark.parametrize("body", [None, [], {}, {"action": "nope"},
                                   {"action": "entity_info", "entityCode": "X", "agentCode": "COG-0007", "requestId": "req-00000001"},
                                   {"action": "entity_info", "entityCode": "SMC-0001", "agentCode": "AGT-1", "requestId": "req-00000001"},
                                   {"action": "entity_info", "entityCode": "SMC-0001", "agentCode": "COG-0007", "requestId": "x"}])
def test_malformed_requests_are_400(body):
    status, resp = dd.handle(base_db(), body)
    assert status == 400 and resp["ok"] is False


def test_unknown_chama():
    status, resp = call(base_db(), "entity_info", {}, entity="SMC-0042")
    assert resp["error"]["code"] == "entity_not_found"


def test_unauthorised_desk_is_refused_for_every_action_and_leaves_audit():
    db = base_db()
    for action in dd.ACTIONS:
        _, resp = call(db, action, {"rows": [], "kind": "members"}, agent="COG-0099", rid=f"req-{action}-1")
        assert resp["ok"] is False and resp["error"]["code"] == "not_authorised", action
    assert not any(k.startswith("chamas/c1/deskDelegateLog/") for k in db.store)
    assert sum(1 for k in db.store if k.startswith("chamas/c1/deskAudit/")) == len(dd.ACTIONS)


def test_top_desk_is_always_authorised_even_when_not_connected():
    db = base_db(agents={})
    _, resp = call(db, "entity_info", {}, agent="COG-0000")
    assert resp["ok"] is True


def test_entity_info_reports_admin_plan_credits_audiences_reports_exports():
    _, resp = call(base_db(), "entity_info", {})
    r = resp["result"]
    assert r["displayName"] == "Umoja" and r["adminName"] == "Chair Person" and r["adminPhone"] == "+254712000001"
    assert r["plan"] == "Starter" and r["creditsBalance"] == 100
    assert "loan_holders" in r["audiences"] and "profit_loss" in r["reportTypes"] and r["exportKinds"] == ["members"]
    assert call(base_db(plan="free"), "entity_info", {})[1]["result"]["exportKinds"] == []


# ---------------------------------------------------------------- member import
ROWS = [
    {"name": "Amina W", "phone": "0722000001", "idNumber": "12345678"},
    {"name": "", "phone": "0722000002", "idNumber": "12345678"},
    {"name": "Bad Phone", "phone": "123", "idNumber": "12345678"},
    {"name": "Dup", "phone": "0722000001", "idNumber": "22345678"},
    {"name": "Existing", "phone": "0712000001", "idNumber": "32345678"},
]


def test_validate_records_uses_app_rules_and_catches_duplicates():
    _, resp = call(base_db(), "validate_records", {"rows": ROWS})
    res = resp["result"]
    assert [v["name"] for v in res["valid"]] == ["Amina W"]
    fields = {(e["row"], e["field"]) for e in res["errors"]}
    assert {(2, "name"), (3, "phone"), (4, "phone"), (5, "phone")} <= fields


def test_commit_is_idempotent_by_request_id():
    db = base_db()
    payload = {"rows": ROWS, "source": "excel"}
    _, first = call(db, "commit_records", payload, rid="commit-0001")
    assert first["result"]["created"] == 1 and first["result"]["skipped"] == 4
    members = [k for k in db.store if k.startswith("chamas/c1/members/")]
    _, again = call(db, "commit_records", payload, rid="commit-0001")
    assert again == first
    assert [k for k in db.store if k.startswith("chamas/c1/members/")] == members      # no second effect
    assert sum(1 for k in db.store if k.startswith("chamas/c1/invites/")) == 1


def test_request_id_cannot_be_reused_for_another_action():
    db = base_db()
    call(db, "commit_records", {"rows": ROWS, "source": "excel"}, rid="commit-0002")
    _, resp = call(db, "export_data", {"kind": "members"}, rid="commit-0002")
    assert resp["error"]["code"] == "request_id_reused"


def test_plan_member_limit_is_enforced_on_commit():
    members = {f"chamas/c1/members/x{i}": {"phoneNormalized": f"+2547990000{i:02d}", "status": "active"} for i in range(14)}
    db = base_db(plan="starter", extra=members)                       # 14 + chair = 15 = Starter limit
    _, resp = call(db, "commit_records", {"rows": [ROWS[0]], "source": "manual"}, rid="commit-0003")
    assert resp["result"]["created"] == 0 and any(e["field"] == "plan" for e in resp["result"]["errors"])


# ---------------------------------------------------------------- SMS
def test_send_dry_run_counts_without_charging_or_logging(monkeypatch):
    db = base_db(credits=1, extra={"chamas/c1/members/m2": {"phoneNormalized": "+254722000001", "status": "active"}})
    monkeypatch.setattr(sms, "send_sms", lambda **kw: pytest.fail("a dry run must not send"))
    _, resp = call(db, "send_sms_now", {"message": "Meeting on Friday", "audience": "all", "dryRun": True}, rid="dry-run-0001")
    assert resp["result"] == {"queued": 2, "creditsUsed": 2, "creditsRemaining": 1}
    assert db.store["chamas/c1"]["smsCredits"] == 1
    assert not any(k.startswith("chamas/c1/deskDelegateLog/") for k in db.store)


def test_send_charges_credits_once_and_replays(monkeypatch):
    sent = []
    monkeypatch.setattr(sms, "send_sms", lambda **kw: sent.append(kw["phone_e164"]))
    import types
    for n in ("HP_USERID", "HP_PASSWORD", "HP_APIKEY", "HP_SENDER_ID"):
        monkeypatch.setattr(sms, n, types.SimpleNamespace(value="x"))
    db = base_db(credits=10)
    _, r1 = call(db, "send_sms_now", {"message": "Meeting on Friday", "audience": "all"}, rid="send-00001")
    assert r1["result"] == {"queued": 1, "creditsUsed": 1, "creditsRemaining": 9}
    _, r2 = call(db, "send_sms_now", {"message": "Meeting on Friday", "audience": "all"}, rid="send-00001")
    assert r2 == r1 and len(sent) == 1 and db.store["chamas/c1"]["smsCredits"] == 9


def test_send_refuses_without_enough_credits_and_releases_the_key():
    db = base_db(credits=0)
    _, resp = call(db, "send_sms_now", {"message": "Meeting on Friday", "audience": "all"}, rid="send-00002")
    assert resp["ok"] is False and "SMS credits" in resp["error"]["message"]
    assert not any(k.startswith("chamas/c1/deskDelegateLog/") for k in db.store)       # retry with same id is possible


def test_schedule_rejects_one_off_and_weekday_lists_then_creates_a_recurring_schedule():
    db = base_db()
    sched = lambda **kw: {"name": "n", "message": "Pay your contribution", "audience": "all", "schedule": kw}
    assert call(db, "schedule_sms", sched(kind="once", at="2099-01-01T09:00"), rid="sched-0001")[1]["ok"] is False
    assert call(db, "schedule_sms", sched(kind="weekly", at="2099-01-01T09:00", days=[1]), rid="sched-0002")[1]["ok"] is False
    assert call(db, "schedule_sms", sched(kind="weekly", at="2001-01-01T09:00"), rid="sched-0003")[1]["error"]["message"].endswith("future.")
    _, ok = call(db, "schedule_sms", sched(kind="weekly", at="2099-01-01T09:00"), rid="sched-0004")
    assert ok["result"]["recipients"] == 1 and ok["result"]["creditsPerRun"] == 1
    doc = db.store[f"chamas/c1/smsSchedules/{ok['result']['scheduleId']}"]
    assert doc["status"] == "active" and doc["frequency"] == "weekly" and doc["body"] == "Pay your contribution"


# ---------------------------------------------------------------- reports / exports
def test_run_report_uses_the_engine_with_a_15_minute_link(monkeypatch):
    seen = {}
    monkeypatch.setattr(reports, "generate_report_core", lambda db, cid, **kw: seen.update(kw) or {"url": "https://signed/x"})
    _, resp = call(base_db(), "run_report", {"reportType": "profit_loss", "params": {"format": "pdf", "period": "last_month"}}, rid="rep-000001")
    assert resp["result"]["downloadUrl"] == "https://signed/x"
    assert seen["url_ttl"].total_seconds() == 900
    assert call(base_db(), "run_report", {"reportType": "minutes"}, rid="rep-000002")[1]["ok"] is False


def test_export_members_has_no_id_numbers_and_needs_a_paid_plan(monkeypatch):
    got = {}
    monkeypatch.setattr(engine, "upload_and_sign", lambda cid, name, content, ctype, ttl: got.update(content=content, ttl=ttl) or "https://signed/e")
    db = base_db(extra={"chamas/c1/members/m2": {"name": "Z", "phoneNormalized": "+254722000001", "idNumber": "99999999", "role": "member", "status": "active"}})
    _, resp = call(db, "export_data", {"kind": "members"}, rid="exp-000001")
    assert resp["result"]["downloadUrl"] == "https://signed/e" and b"99999999" not in got["content"] and got["ttl"].total_seconds() == 900
    assert call(base_db(plan="free"), "export_data", {"kind": "members"}, rid="exp-000002")[1]["ok"] is False


def test_unexpected_failure_is_500_and_releases_the_key(monkeypatch):
    monkeypatch.setattr(reports, "generate_report_core", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    db = base_db()
    status, resp = call(db, "run_report", {"reportType": "profit_loss"}, rid="rep-000009")
    assert status == 500 and resp["error"]["code"] == "internal" and "boom" not in resp["error"]["message"]
    assert not any(k.startswith("chamas/c1/deskDelegateLog/") for k in db.store)


# ---------------------------------------------------------------- deployment shape
def test_deskdelegate_is_private_post_only_and_exactly_named():
    assert dd.deskdelegate.__name__ == "deskdelegate"
    ep = dd.deskdelegate.__firebase_endpoint__
    assert ep.httpsTrigger["invoker"] == ["private"]


# ---------------------------------------------------------------- routing + outbox
def chama_with(*codes):
    return {"supportAgents": {c: {"addedAt": i} for i, c in enumerate(codes)}}


def test_routing_rules():
    assert ds.route_targets({}, None, False) == ["COG-0000"]
    assert ds.route_targets({}, None, True) == ["COG-0000"]
    assert ds.route_targets(chama_with("COG-0009", "COG-0003"), None, False) == ["COG-0009"]          # first connected
    assert ds.route_targets(chama_with("COG-0009", "COG-0003"), "COG-0003", False) == ["COG-0003"]    # chosen
    assert ds.route_targets(chama_with("COG-0009"), None, True) == ["COG-0009", "COG-0000"]
    assert ds.route_targets(chama_with("COG-0009"), "COG-0000", False) == ["COG-0000"]
    with pytest.raises(https_fn.HttpsError):
        ds.route_targets(chama_with("COG-0009"), "COG-0044", False)                                    # not connected


def fake_request(uid="u1", **data):
    return type("R", (), {"auth": type("A", (), {"uid": uid, "token": {}})(), "data": data})()


def with_membership(db, role="chair"):
    db.store["userChamas/u1/memberships/c1"] = {"memberId": "m1", "role": role, "status": "active", "chamaName": "Umoja"}
    return db


def test_create_request_writes_one_outbox_item_and_limits_five_a_day(monkeypatch):
    db = with_membership(base_db())
    monkeypatch.setattr(ds, "_db", lambda: db)
    create = unwrap(ds.createDeskRequest)
    r = create(fake_request(chamaId="c1", category="sms", subject="Help", message="Please assist", alsoTopDesk=True))
    assert r["targetDeskCodes"] == ["COG-0007", "COG-0000"]
    item = db.store[f"desk_requests/{r['id']}"]
    assert item["kind"] == "support" and item["status"] == "new" and item["entityCode"] == "SMC-0001"
    assert item["requesterName"] == "Chair Person" and item["chamaId"] == "c1"
    for _ in range(4):
        create(fake_request(chamaId="c1", category="sms", subject="Help", message="Again"))
    with pytest.raises(https_fn.HttpsError) as e:
        create(fake_request(chamaId="c1", category="sms", subject="Help", message="Sixth"))
    assert e.value.code == "resource-exhausted"
    assert sum(1 for k in db.store if k.startswith("desk_requests/")) == 5


def test_create_request_validates_and_refuses_plain_members(monkeypatch):
    db = with_membership(base_db(), role="member")
    monkeypatch.setattr(ds, "_db", lambda: db)
    with pytest.raises(https_fn.HttpsError):
        unwrap(ds.createDeskRequest)(fake_request(chamaId="c1", category="sms", subject="s", message="m"))
    with_membership(db, role="chair")
    for bad in ({"category": "x"}, {"subject": ""}, {"message": "m" * 2001}):
        with pytest.raises(https_fn.HttpsError):
            unwrap(ds.createDeskRequest)(fake_request(chamaId="c1", **{"category": "sms", "subject": "s", "message": "m", **bad}))


def test_list_shows_what_desk_wrote_back(monkeypatch):
    db = with_membership(base_db())
    monkeypatch.setattr(ds, "_db", lambda: db)
    db.store["desk_requests/r1"] = {"chamaId": "c1", "subject": "S", "category": "sms", "message": "m", "targetDeskCodes": ["COG-0007"],
                                    "status": "pulled", "deskStatus": "answered", "createdAt": 5,
                                    "responses": [{"at": 6, "byDeskCode": "COG-0007", "text": "Done"}]}
    db.store["desk_requests/r2"] = {"chamaId": "other", "subject": "Not mine", "createdAt": 9}
    out = unwrap(ds.listDeskRequests)(fake_request(chamaId="c1"))
    assert [x["id"] for x in out["requests"]] == ["r1"] and out["requests"][0]["deskStatus"] == "answered"


# ---------------------------------------------------------------- support agents
def test_support_agent_rules(monkeypatch):
    db = with_membership(base_db(agents={}), role="treasurer")
    monkeypatch.setattr(ds, "_db", lambda: db)
    add, rem, lst = unwrap(ds.addSupportAgent), unwrap(ds.removeSupportAgent), unwrap(ds.listSupportAgents)
    for bad in ("COG-0000", "cog-12", "AGT-0001", ""):
        with pytest.raises(https_fn.HttpsError):
            add(fake_request(chamaId="c1", agentCode=bad))
    with pytest.raises(https_fn.HttpsError):
        rem(fake_request(chamaId="c1", agentCode="COG-0000"))
    for i in range(1, 6):
        assert add(fake_request(chamaId="c1", agentCode=f"COG-000{i}"))["ok"]
    with pytest.raises(https_fn.HttpsError) as e:
        add(fake_request(chamaId="c1", agentCode="COG-0006"))
    assert e.value.code == "resource-exhausted"
    assert add(fake_request(chamaId="c1", agentCode="cog-0001"))["added"] is False                     # idempotent
    rem(fake_request(chamaId="c1", agentCode="COG-0002"))
    rows = lst(fake_request(chamaId="c1"))["agents"]
    assert rows[0] == {"agentCode": "COG-0000", "name": "Samuhia company desk", "addedAt": 0, "locked": True}
    assert [r["agentCode"] for r in rows[1:]] == ["COG-0001", "COG-0003", "COG-0004", "COG-0005"]
    assert db.store["chamas/c1"]["supportAgents"]["COG-0001"]["addedBy"] == "m1"


def test_support_agents_need_chair_or_treasurer(monkeypatch):
    db = with_membership(base_db(), role="secretary")
    monkeypatch.setattr(ds, "_db", lambda: db)
    with pytest.raises(https_fn.HttpsError):
        unwrap(ds.addSupportAgent)(fake_request(chamaId="c1", agentCode="COG-0010"))
    with pytest.raises(https_fn.HttpsError):
        unwrap(ds.listSupportAgents)(fake_request(chamaId="c1"))
