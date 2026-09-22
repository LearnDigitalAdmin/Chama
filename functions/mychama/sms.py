"""
SMS — Phase 3.

sendSmsCampaign calls HostPinnacle DIRECTLY (MyChama's own credentials),
not through the PAY repo — see docs/ARCHITECTURE.md §6. purchaseSmsCredits
is the one SMS-related thing that IS a payment, so it goes through the
same paymentIntents-adjacent pattern as initiatePayment, but into the
smsTopUps collection with reference prefix MCS- (see
docs/CONVENTIONS.md §5); the PAY repo's webhook extension credits
chamas.smsCredits on success.
"""

from __future__ import annotations

from firebase_functions import https_fn, scheduler_fn
from firebase_admin import firestore

from shared import firestore_paths as paths
from shared import ids
from shared import paystack
from shared.constants import MC, PLANS, SECURITY
from shared.dates import now_ms
from shared.errors import bad_request, not_found, rate_limited, require_auth
from shared.hostpinnacle import send_sms
from shared.idempotency import already_applied, record_result
from shared.phone import detect_provider, is_valid_kenyan_phone, normalize_phone, normalize_sms_phone
from shared.roles import require_official
from shared.secrets import PAYSTACK_SECRET_KEY, HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID

REGION = "africa-south1"


def _db():
    return firestore.client()


def _recipients(db, chama_id: str, audience: str, member_ids: list[str] | None) -> list[dict]:
    if audience == "custom":
        if not member_ids:
            return []
        docs = [db.document(paths.member(chama_id, mid)).get() for mid in member_ids]
        return [d.to_dict() | {"id": d.id} for d in docs if d.exists]

    members = list(db.collection(paths.members(chama_id)).where("status", "==", "active").stream())
    if audience == "all":
        return [d.to_dict() | {"id": d.id} for d in members]

    if audience == "overdue":
        overdue_member_ids = {
            c.to_dict()["memberId"]
            for c in db.collection(paths.contributions(chama_id)).where("status", "==", "overdue").stream()
        }
        return [d.to_dict() | {"id": d.id} for d in members if d.id in overdue_member_ids]

    return []


@https_fn.on_call(region=REGION, secrets=[HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID])
def sendSmsCampaign(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    audience = data.get("audience")
    message = (data.get("message") or "").strip()

    if not chama_id or audience not in ("all", "overdue", "custom") or not message:
        raise bad_request("chamaId, audience, and message are required.")

    db = _db()
    require_official(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    chama_ref = db.document(paths.chama(chama_id))
    chama_snap = chama_ref.get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    chama = chama_snap.to_dict()
    plan = chama.get("plan", "free")
    rate = PLANS.get(plan, PLANS["free"])["smsRate"]

    recipients = _recipients(db, chama_id, audience, data.get("memberIds"))
    recipients = [m for m in recipients if m.get("phoneNormalized") and m.get("whatsappOptIn", True) is not False]
    if not recipients:
        return {"sent": 0, "creditsUsed": 0}

    cost = round(len(recipients) * rate * 100) / 100
    credits = chama.get("smsCredits", 0)
    if credits < cost:
        raise rate_limited(f"Not enough SMS credits — this send needs {cost}, you have {credits}. Top up first.")

    sent = 0
    ts = now_ms()
    for member in recipients:
        try:
            send_sms(
                userid=HP_USERID.value,
                password=HP_PASSWORD.value,
                apikey=HP_APIKEY.value,
                sender_id=HP_SENDER_ID.value,
                phone_e164=normalize_sms_phone(member["phoneNormalized"]),
                message=message,
            )
            sent += 1
        except Exception:  # noqa: BLE001 — one failed send must not abort the whole campaign
            continue

    actual_cost = round(sent * rate * 100) / 100
    chama_ref.update({"smsCredits": credits - actual_cost, "updatedAt": ts})
    db.collection(paths.sms_log(chama_id)).document().set({
        "audience": audience,
        "message": message,
        # The member IDs this campaign was addressed to (regardless of
        # individual SMS delivery success) — this is what the in-app
        # Messages inbox (Phase 4) filters on, so a member sees a message
        # here even if their SMS itself failed to deliver.
        "recipientIds": [m["id"] for m in recipients],
        "recipientCount": len(recipients),
        "sentCount": sent,
        "creditsUsed": actual_cost,
        "sentBy": uid,
        "createdAt": ts,
    })

    result = {"sent": sent, "creditsUsed": actual_cost}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


@https_fn.on_call(region=REGION, secrets=[PAYSTACK_SECRET_KEY])
def purchaseSmsCredits(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    amount_kes = data.get("amountKes")
    phone = data.get("phone") or ""

    if not chama_id:
        raise bad_request("chamaId is required.")
    if not isinstance(amount_kes, (int, float)) or amount_kes <= 0:
        raise bad_request("amountKes must be a positive number.")
    if not is_valid_kenyan_phone(phone):
        raise bad_request("A valid Kenyan phone number is required.")

    db = _db()
    require_official(db, uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        return dedup

    reference = ids.build_sms_topup_reference(chama_id)
    ts = now_ms()
    normalized_phone = normalize_phone(phone)

    db.document(paths.sms_topup(chama_id, reference)).set({
        "chamaId": chama_id,
        "amountKes": float(amount_kes),
        "phone": normalized_phone,
        "status": "pending",
        "createdAt": ts,
        "expiresAt": ts + SECURITY["PAYMENT_INTENT_TTL_SECONDS"] * 1000,
    })

    try:
        paystack.charge_mobile_money(
            secret_key=PAYSTACK_SECRET_KEY.value,
            email=f"{chama_id}@mychama.app",
            amount_kes=float(amount_kes),
            phone_e164=normalized_phone,
            provider=detect_provider(phone),
            reference=reference,
            metadata={"chargeType": "mychama_sms_topup", "targetProject": "mychama1", "chamaId": chama_id},
        )
    except Exception as exc:  # noqa: BLE001
        db.document(paths.sms_topup(chama_id, reference)).update({"status": "failed", "updatedAt": now_ms()})
        from shared.errors import upstream_failure
        raise upstream_failure("Could not start the top-up payment with Paystack. Please try again.") from exc

    result = {"reference": reference}
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


def _frequency_ms(frequency: str) -> int:
    return {"daily": 24 * 60 * 60 * 1000, "weekly": 7 * 24 * 60 * 60 * 1000, "monthly": 30 * 24 * 60 * 60 * 1000}.get(
        frequency, 30 * 24 * 60 * 60 * 1000
    )


@scheduler_fn.on_schedule(
    schedule="every 15 minutes",
    region=REGION,
    timezone=scheduler_fn.Timezone("Africa/Nairobi"),
    secrets=[HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID],
)
def run_sms_schedules(event: scheduler_fn.ScheduledEvent) -> None:
    """
    Dispatches chamas/{chamaId}/smsSchedules entries whose nextRun has
    passed. Each schedule doc: { message, audience, memberIds?, frequency,
    nextRun (epoch ms), active }.
    """
    db = _db()
    now = now_ms()

    chamas = db.collection(MC.CHAMAS).where("status", "==", "active").stream()
    for chama_doc in chamas:
        chama_id = chama_doc.id
        chama = chama_doc.to_dict()
        plan = chama.get("plan", "free")
        rate = PLANS.get(plan, PLANS["free"])["smsRate"]

        due = (
            db.collection(paths.sms_schedules(chama_id))
            .where("active", "==", True)
            .where("nextRun", "<=", now)
            .stream()
        )
        for sched_doc in due:
            sched = sched_doc.to_dict()
            recipients = _recipients(db, chama_id, sched.get("audience", "all"), sched.get("memberIds"))
            recipients = [m for m in recipients if m.get("phoneNormalized")]
            cost = round(len(recipients) * rate * 100) / 100

            credits = chama.get("smsCredits", 0)
            if credits < cost or not recipients:
                # Not enough credit or nobody to send to — push nextRun forward
                # by one frequency step so it's retried next cycle rather than
                # spamming the same failure every 15 minutes.
                sched_doc.reference.update({"nextRun": now + _frequency_ms(sched.get("frequency", "monthly"))})
                continue

            sent = 0
            for member in recipients:
                try:
                    send_sms(
                        userid=HP_USERID.value,
                        password=HP_PASSWORD.value,
                        apikey=HP_APIKEY.value,
                        sender_id=HP_SENDER_ID.value,
                        phone_e164=normalize_sms_phone(member["phoneNormalized"]),
                        message=sched["message"],
                    )
                    sent += 1
                except Exception:  # noqa: BLE001
                    continue

            actual_cost = round(sent * rate * 100) / 100
            db.document(paths.chama(chama_id)).update({"smsCredits": credits - actual_cost, "updatedAt": now_ms()})
            db.collection(paths.sms_log(chama_id)).document().set({
                "audience": sched.get("audience", "all"),
                "message": sched["message"],
                "recipientIds": [m["id"] for m in recipients],
                "recipientCount": len(recipients),
                "sentCount": sent,
                "creditsUsed": actual_cost,
                "sentBy": "schedule:" + sched_doc.id,
                "createdAt": now_ms(),
            })
            sched_doc.reference.update({"nextRun": now + _frequency_ms(sched.get("frequency", "monthly")), "lastRun": now_ms()})
