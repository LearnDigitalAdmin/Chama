"""
HostPinnacle SMS helper for mychama1's own Python functions.

Mirrors the PAY repo's SMS_CONFIG/send pattern (functions/src/index.ts) but
uses MyChama's own HostPinnacle credentials (Secret Manager), and is called
DIRECTLY by mychama1's Python functions rather than routed through the PAY
repo — see docs/ARCHITECTURE.md §6. Only SMS *credit purchases* (a payment)
go through the PAY webhook; the actual sending never does.
"""

from __future__ import annotations

import re

import requests

SMS_API_URL = "https://smsportal.hostpinnacle.co.ke/SMSApi/send"
MAX_SMS_LENGTH = 400

_NON_GSM = re.compile(r"[^\x00-\x7F\u00A0-\u00FF]")


def clean_sms_text(text: str) -> str:
    """Strips non-GSM characters and trims to the HostPinnacle length cap — mirrors the PAY repo's equivalent helper."""
    cleaned = _NON_GSM.sub("", text or "")
    return cleaned[:MAX_SMS_LENGTH]


def send_sms(*, userid: str, password: str, apikey: str, sender_id: str, phone_e164: str, message: str) -> dict:
    """
    Sends one transactional SMS. Raises on a transport-level failure;
    HostPinnacle's own "was it actually delivered" status lives in the
    response body and is worth logging but not blocking the caller on.
    """
    payload = {
        "userid": userid,
        "password": password,
        "apikey": apikey,
        "senderid": sender_id,
        "mobile": phone_e164.lstrip("+"),
        "msg": clean_sms_text(message),
        "sendMethod": "quick",
        "msgType": "text",
        "output": "json",
        "duplicatecheck": "true",
    }
    resp = requests.post(SMS_API_URL, json=payload, timeout=20)
    resp.raise_for_status()
    return resp.json()
