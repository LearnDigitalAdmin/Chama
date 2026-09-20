"""
Standard error helpers for callable functions.

Every callable in mychama1 raises `HttpsError` from firebase_functions, using
ONE of the codes below, so the frontend's callables.ts wrapper (src/lib) can
show a consistent message without string-matching error text.
"""

from __future__ import annotations

from firebase_functions import https_fn


class ErrorCode:
    UNAUTHENTICATED = "unauthenticated"
    PERMISSION_DENIED = "permission-denied"
    NOT_FOUND = "not-found"
    ALREADY_EXISTS = "already-exists"
    INVALID_ARGUMENT = "invalid-argument"
    FAILED_PRECONDITION = "failed-precondition"
    RESOURCE_EXHAUSTED = "resource-exhausted"  # rate limits, plan limits
    INTERNAL = "internal"
    UNAVAILABLE = "unavailable"  # upstream (Paystack/HostPinnacle) failure


def require_auth(req: https_fn.CallableRequest) -> str:
    """Returns the caller's uid or raises unauthenticated."""
    if req.auth is None:
        raise https_fn.HttpsError(ErrorCode.UNAUTHENTICATED, "Sign in required.")
    return req.auth.uid


def bad_request(message: str) -> https_fn.HttpsError:
    return https_fn.HttpsError(ErrorCode.INVALID_ARGUMENT, message)


def not_found(message: str) -> https_fn.HttpsError:
    return https_fn.HttpsError(ErrorCode.NOT_FOUND, message)


def denied(message: str) -> https_fn.HttpsError:
    return https_fn.HttpsError(ErrorCode.PERMISSION_DENIED, message)


def precondition(message: str) -> https_fn.HttpsError:
    return https_fn.HttpsError(ErrorCode.FAILED_PRECONDITION, message)


def rate_limited(message: str) -> https_fn.HttpsError:
    return https_fn.HttpsError(ErrorCode.RESOURCE_EXHAUSTED, message)


def upstream_failure(message: str) -> https_fn.HttpsError:
    return https_fn.HttpsError(ErrorCode.UNAVAILABLE, message)
