"""
HTTP response helpers for API Gateway Lambda functions.
"""
import json
import os
from typing import Any, Optional

# Comma-separated list of allowed origins injected by CDK at deploy time.
# Falls back to localhost dev server if the env var is missing.
_ALLOWED_ORIGINS: set = set(
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
)

_BASE_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
}


def _cors_headers(event: dict | None = None) -> dict:
    """
    Return CORS headers with the correct Access-Control-Allow-Origin value.

    Browsers require the response to echo back the *exact* request Origin
    (not a wildcard) when the request includes an Authorization header.
    We check the request Origin against our allowlist and echo it if allowed,
    otherwise we return the first allowed origin as a safe fallback.
    """
    origin = None
    if event:
        origin = (event.get("headers") or {}).get("origin") or \
                 (event.get("headers") or {}).get("Origin")

    if origin and origin in _ALLOWED_ORIGINS:
        allow_origin = origin
    else:
        # Safe fallback — browser will block the request anyway if origin is wrong
        allow_origin = next(iter(_ALLOWED_ORIGINS))

    return {
        **_BASE_HEADERS,
        "Access-Control-Allow-Origin": allow_origin,
        "Vary": "Origin",
    }


# Keep module-level CORS_HEADERS for backwards compatibility with any
# code that imports it directly (e.g. older handlers that don't pass event).
CORS_HEADERS = {
    **_BASE_HEADERS,
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Vary": "Origin",
}


def success(body: Any, status_code: int = 200, event: dict | None = None) -> dict:
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": json.dumps(body, default=str),
    }


def error(message: str, status_code: int = 500, details: Optional[Any] = None,
          event: dict | None = None) -> dict:
    body: dict = {"error": message}
    if details:
        body["details"] = details
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": json.dumps(body),
    }


def not_found(message: str = "Resource not found", event: dict | None = None) -> dict:
    return error(message, 404, event=event)


def bad_request(message: str, event: dict | None = None) -> dict:
    return error(message, 400, event=event)


def unauthorized(message: str = "Unauthorized", event: dict | None = None) -> dict:
    return error(message, 401, event=event)


def get_tenant_id(event: dict) -> str:
    """Extract Cognito user ID (sub) from the API Gateway event."""
    try:
        return event["requestContext"]["authorizer"]["claims"]["sub"]
    except (KeyError, TypeError):
        raise ValueError("Could not extract tenant_id from event. Is Cognito authorizer configured?")
