"""
Centralised Secret Manager parameter declarations.

firebase_functions raises if the same SecretParam name is declared twice
across modules (e.g. payments.py and sms.py both needing the Paystack
key) — so every secret used anywhere in mychama1's functions is declared
ONCE here and imported everywhere else. Set these with:

    firebase functions:secrets:set MYCHAMA_PAYSTACK_SECRET_KEY
    firebase functions:secrets:set MYCHAMA_HP_SMS_USERID
    firebase functions:secrets:set MYCHAMA_HP_SMS_PASSWORD
    firebase functions:secrets:set MYCHAMA_HP_SMS_APIKEY
    firebase functions:secrets:set MYCHAMA_HP_SMS_SENDERID
"""

from __future__ import annotations

from firebase_functions.params import SecretParam

PAYSTACK_SECRET_KEY = SecretParam("MYCHAMA_PAYSTACK_SECRET_KEY")
HP_USERID = SecretParam("MYCHAMA_HP_SMS_USERID")
HP_PASSWORD = SecretParam("MYCHAMA_HP_SMS_PASSWORD")
HP_APIKEY = SecretParam("MYCHAMA_HP_SMS_APIKEY")
HP_SENDER_ID = SecretParam("MYCHAMA_HP_SMS_SENDERID")
