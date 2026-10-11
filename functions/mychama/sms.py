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
from mychama import desk_commission
from shared.constants import MC, SECURITY
from shared.dates import now_ms
from shared.errors import bad_request, not_found, rate_limited, require_auth
from shared.hostpinnacle import send_sms
from shared.idempotency import already_applied, record_result
from shared.phone import detect_provider, is_valid_kenyan_phone, normalize_phone, normalize_sms_phone
from shared.roles import require_official
from shared.secrets import PAYSTACK_SECRET_KEY, HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID
from shared.sms_validation import MAX_SMS_LENGTH, count_sms_segments, validate_sms_content
import logging

REGION = "africa-south1"


def _db():
    return firestore.client()


def _recipients(db, chama_id: str, audience: str, member_ids: list[str] | None) -> list[dict]:
    if audience == "custom":
        if not member_ids:
            return []
        docs = [db.document(paths.member(chama_id, mid)).get() for mid in member_ids]
        return [d.to_dict() | {"id": d.id} for d in docs if d.exists]

    members = [
        d.to_dict() | {"id": d.id}
        for d in db.collection(paths.members(chama_id)).where("status", "==", "active").stream()
    ]
    if audience == "all":
        return members

    if audience == "overdue":
        overdue_member_ids = {
            c.to_dict()["memberId"]
            for c in db.collection(paths.contributions(chama_id)).where("status", "==", "overdue").stream()
        }
        return [m for m in members if m["id"] in overdue_member_ids]

    if audience == "loan_holders":
        loan_member_ids = {
            loan.to_dict()["memberId"]
            for loan in db.collection(paths.loans(chama_id)).where("status", "in", ["active", "overdue"]).stream()
        }
        return [m for m in members if m["id"] in loan_member_ids]

    if audience == "admins":
        return [m for m in members if m.get("isAdmin")]

    return []



@https_fn.on_call(region=REGION, secrets=[HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID])
def sendSmsCampaign(req: https_fn.CallableRequest) -> dict:
    uid = require_auth(req)
    data = req.data or {}
    chama_id = data.get("chamaId")
    audience = data.get("audience")
    message = (data.get("message") or "").strip()

    logging.info(
        "sendSmsCampaign: start uid=%s chamaId=%s audience=%s msgLen=%d clientRequestId=%s",
        uid, chama_id, audience, len(message), data.get("clientRequestId"),
    )

    if not chama_id or audience not in ("all", "overdue", "custom", "loan_holders", "admins") or not message:
        logging.warning(
            "sendSmsCampaign: validation failed chamaId=%s audience=%s msgEmpty=%s",
            chama_id, audience, not message,
        )
        raise bad_request("chamaId, audience, and message are required.")

    db = _db()
    require_official(db, uid, chama_id)
    logging.info("sendSmsCampaign: uid=%s confirmed official for chamaId=%s", uid, chama_id)

    dedup = already_applied(db, chama_id, data.get("clientRequestId"))
    if dedup is not None:
        logging.info(
            "sendSmsCampaign: short-circuiting on dedup clientRequestId=%s result=%s",
            data.get("clientRequestId"), dedup,
        )
        return dedup

    chama_snap = db.document(paths.chama(chama_id)).get()
    if not chama_snap.exists:
        logging.warning("sendSmsCampaign: chama not found chamaId=%s", chama_id)
        raise not_found("Chama not found.")

    result = send_campaign(db, chama_id, chama_snap.to_dict(), audience, message, data.get("memberIds"), sent_by=uid)
    logging.info("sendSmsCampaign: complete result=%s", result)
    record_result(db, chama_id, data.get("clientRequestId"), result)
    return result


def plan_campaign(db, chama_id: str, chama: dict, audience: str, message: str, member_ids: list[str] | None) -> dict:
    """
    The rules for one campaign, shared by sendSmsCampaign and desk's schedule_sms/send_sms_now: content and
    segment validation, recipient resolution + opt-in/phone filter, 1 credit per segment per recipient.
    Returns {"recipients", "segments", "cost", "credits"}. Raises HttpsError on a rule failure.
    """
    content_error = validate_sms_content(message)
    if content_error:
        raise bad_request(content_error)
    segments = count_sms_segments(message)
    if segments is None:
        raise bad_request(
            f"Message is {len(message)} characters — SMS campaigns are capped at {MAX_SMS_LENGTH} characters (3 segments)."
        )
    recipients = _recipients(db, chama_id, audience, member_ids)
    recipients = [m for m in recipients if m.get("phoneNormalized") and m.get("whatsappOptIn", True) is not False]
    # 1 credit per SMS segment per recipient — flat across every plan tier. PLANS[plan].smsRate is the KES
    # price per credit at top-up time and must not be multiplied in here.
    return {
        "recipients": recipients,
        "segments": segments,
        "cost": segments * len(recipients),
        "credits": chama.get("smsCredits", 0),
    }


def send_campaign(
    db, chama_id: str, chama: dict, audience: str, message: str, member_ids: list[str] | None, *, sent_by: str,
    dry_run: bool = False,
) -> dict:
    """
    Sends (or, with dry_run, only counts) one campaign through MyChama's own credits and HostPinnacle path.
    Must be called from a function that declares the HP_* secrets. Returns
    {"sent", "creditsUsed", "recipients", "creditsRemaining"}; the callable adds nothing to it.
    """
    plan = plan_campaign(db, chama_id, chama, audience, message, member_ids)
    recipients, segments, cost, credits = plan["recipients"], plan["segments"], plan["cost"], plan["credits"]
    if not recipients:
        return {"sent": 0, "creditsUsed": 0, "recipients": 0, "creditsRemaining": credits}
    if dry_run:  # a quote: count only, never charge or send, and never fail on a low balance
        return {"sent": 0, "creditsUsed": 0, "recipients": len(recipients), "creditsRemaining": credits, "wouldUse": cost}
    if credits < cost:
        raise rate_limited(f"Not enough SMS credits — this send needs {cost}, you have {credits}. Top up first.")

    sent = 0
    failed = 0
    for member in recipients:
        phone = member.get("phoneNormalized")
        try:
            send_sms(
                userid=HP_USERID.value,
                password=HP_PASSWORD.value,
                apikey=HP_APIKEY.value,
                sender_id=HP_SENDER_ID.value,
                phone_e164=normalize_sms_phone(phone),
                message=message,
            )
            sent += 1
        except Exception as e:  # noqa: BLE001 — one failed send must not abort the whole campaign
            failed += 1
            logging.error(
                "send_campaign: send FAILED memberId=%s phone=%s error=%s: %s", member.get("id"), phone, type(e).__name__, e,
            )
    logging.info("send_campaign: chamaId=%s sent=%d failed=%d", chama_id, sent, failed)

    actual_cost = segments * sent
    ts = now_ms()
    chama_ref = db.document(paths.chama(chama_id))
    # Decrement atomically: the balance read above may be stale if another send ran meanwhile.
    chama_ref.update({"smsCredits": firestore.Increment(-actual_cost), "updatedAt": ts})
    db.collection(paths.sms_log(chama_id)).document().set({
        "audience": audience,
        "message": message,
        # The member IDs this campaign was addressed to (regardless of individual SMS delivery success) —
        # the in-app Messages inbox filters on this.
        "recipientIds": [m["id"] for m in recipients],
        "recipientCount": len(recipients),
        "sentCount": sent,
        "creditsUsed": actual_cost,
        "sentBy": sent_by,
        "createdAt": ts,
    })
    return {"sent": sent, "creditsUsed": actual_cost, "recipients": len(recipients), "creditsRemaining": credits - actual_cost}


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

    # Desk commission (W2-A): SMS = 40% of margin; prepared before the pending doc so a failure leaves nothing behind.
    chama_snap = db.document(paths.chama(chama_id)).get()
    if not chama_snap.exists:
        raise not_found("Chama not found.")
    prepared = desk_commission.prepare_split(
        db, PAYSTACK_SECRET_KEY.value, chama_snap.to_dict() or {}, desk_commission.KIND_SMS, float(amount_kes)
    )

    db.document(paths.sms_topup(chama_id, reference)).set({
        "chamaId": chama_id,
        "amountKes": float(amount_kes),
        "phone": normalized_phone,
        "status": "pending",
        "createdAt": ts,
        "expiresAt": ts + SECURITY["PAYMENT_INTENT_TTL_SECONDS"] * 1000,
        **({"deskCommission": prepared.desk_commission} if prepared else {}),
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
            split_code=prepared.split_code if prepared else None,
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
    schedule="every 60 minutes",
    region="us-central1",
    timezone=scheduler_fn.Timezone("Africa/Nairobi"),
    secrets=[HP_USERID, HP_PASSWORD, HP_APIKEY, HP_SENDER_ID],
)
def run_sms_schedules(event: scheduler_fn.ScheduledEvent) -> None:
    """
    Dispatches chamas/{chamaId}/smsSchedules entries whose nextRun has
    passed. Each schedule doc: { body, audience, memberIds?, frequency,
    nextRun (epoch ms), status: 'active'|'paused', potId? }.

    Field names here MUST match firestore.rules' smsSchedules validation
    (`status` and `body`, not `active`/`message` — those were the original
    field names before the rules were written and this cron was never
    updated to match, so a schedule created through the rules-sanctioned
    direct write was silently never picked up. potId is optional and is
    for the UI's benefit only (which pot a reminder schedule belongs to,
    e.g. src/features/mgr/MgrPotDetail.tsx's Reminders card) — it plays no
    part in dispatch.
    """
    db = _db()
    now = now_ms()

    chamas = db.collection(MC.CHAMAS).where("status", "==", "active").stream()
    for chama_doc in chamas:
        chama_id = chama_doc.id
        chama = chama_doc.to_dict()

        due = (
            db.collection(paths.sms_schedules(chama_id))
            .where("status", "==", "active")
            .where("nextRun", "<=", now)
            .stream()
        )
        for sched_doc in due:
            sched = sched_doc.to_dict()
            body = sched.get("body") or sched.get("message") or ""  # tolerate pre-fix docs written under the old field name
            recipients = _recipients(db, chama_id, sched.get("audience", "all"), sched.get("memberIds"))
            recipients = [m for m in recipients if m.get("phoneNormalized")]

            segments = count_sms_segments(body) if body else 0
            content_error = validate_sms_content(body) if body else None
            # 1 credit per SMS segment per recipient — flat across every plan
            # tier; see sendSmsCampaign above for why smsRate must not be
            # multiplied in here.
            cost = (segments or 0) * len(recipients)

            credits = chama.get("smsCredits", 0)
            if credits < cost or not recipients or not body or not segments or content_error:
                # Not enough credit, nobody to send to, an empty/oversized
                # body, or content that fails validation — push nextRun
                # forward by one frequency step so it's retried next cycle
                # rather than spamming the same failure every 15 minutes.
                if content_error or not segments:
                    logging.warning(
                        "run_sms_schedules: skipping invalid schedule chamaId=%s scheduleId=%s error=%s len=%d",
                        chama_id, sched_doc.id, content_error or "message too long", len(body),
                    )
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
                        message=body,
                    )
                    sent += 1
                except Exception:  # noqa: BLE001
                    continue

            actual_cost = segments * sent
            db.document(paths.chama(chama_id)).update({"smsCredits": credits - actual_cost, "updatedAt": now_ms()})
            db.collection(paths.sms_log(chama_id)).document().set({
                "audience": sched.get("audience", "all"),
                "message": body,
                "recipientIds": [m["id"] for m in recipients],
                "recipientCount": len(recipients),
                "sentCount": sent,
                "creditsUsed": actual_cost,
                "sentBy": "schedule:" + sched_doc.id,
                "createdAt": now_ms(),
            })
            sched_doc.reference.update({"nextRun": now + _frequency_ms(sched.get("frequency", "monthly")), "lastRun": now_ms()})
