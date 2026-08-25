"""
Unit tests for the API response helpers.
"""
import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../lambdas/shared"))

from response import success, error, not_found, bad_request, unauthorized, get_tenant_id


def test_success_default_status():
    resp = success({"key": "value"})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["key"] == "value"


def test_success_custom_status():
    resp = success({"id": "123"}, status_code=201)
    assert resp["statusCode"] == 201


def test_error_response():
    resp = error("Something broke")
    assert resp["statusCode"] == 500
    body = json.loads(resp["body"])
    assert body["error"] == "Something broke"


def test_error_with_details():
    resp = error("Validation failed", 400, details={"field": "total"})
    body = json.loads(resp["body"])
    assert body["details"]["field"] == "total"


def test_not_found():
    resp = not_found("Invoice not found")
    assert resp["statusCode"] == 404


def test_bad_request():
    resp = bad_request("Missing required field")
    assert resp["statusCode"] == 400


def test_unauthorized():
    resp = unauthorized()
    assert resp["statusCode"] == 401


def test_cors_headers_present():
    resp = success({})
    assert "Access-Control-Allow-Origin" in resp["headers"]


def test_get_tenant_id_extracts_cognito_sub():
    event = {
        "requestContext": {
            "authorizer": {
                "claims": {"sub": "user-uuid-123"}
            }
        }
    }
    assert get_tenant_id(event) == "user-uuid-123"


def test_get_tenant_id_raises_on_missing_context():
    import pytest
    with pytest.raises(ValueError):
        get_tenant_id({})


def test_get_tenant_id_raises_on_missing_claims():
    import pytest
    event = {"requestContext": {"authorizer": {}}}
    with pytest.raises((ValueError, KeyError, TypeError)):
        get_tenant_id(event)
