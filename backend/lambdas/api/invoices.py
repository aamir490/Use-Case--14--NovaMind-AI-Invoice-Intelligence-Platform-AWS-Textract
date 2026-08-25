"""
API Lambda — Invoice CRUD endpoints

GET  /invoices            → list invoices with filters and pagination
GET  /invoices/{id}       → get single invoice detail
GET  /invoices/{id}/status → get processing job status
DELETE /invoices/{id}     → delete invoice

Environment variables (set by CDK):
  INVOICES_TABLE - DynamoDB invoices table name
  JOBS_TABLE     - DynamoDB jobs table name
  UPLOADS_BUCKET - S3 bucket (for deleting the original file)
"""
import json
import os
import sys
import base64
import boto3
from botocore.exceptions import ClientError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.db import get_invoice, list_invoices, delete_invoice, get_job
from shared.response import success, not_found, bad_request, error, unauthorized, get_tenant_id

UPLOADS_BUCKET = os.environ.get("UPLOADS_BUCKET", "")
s3 = boto3.client("s3")


def handler(event: dict, context) -> dict:
    try:
        tenant_id = get_tenant_id(event)
        method = event.get("httpMethod", "GET")
        path = event.get("path", "")
        path_params = event.get("pathParameters") or {}
        query_params = event.get("queryStringParameters") or {}

        invoice_id = path_params.get("id")

        # Route: GET /invoices/{id}/status
        if invoice_id and path.endswith("/status"):
            return _get_status(tenant_id, invoice_id, event)

        # Route: GET /invoices/{id}
        if invoice_id and method == "GET":
            return _get_invoice(tenant_id, invoice_id, event)

        # Route: DELETE /invoices/{id}
        if invoice_id and method == "DELETE":
            return _delete_invoice(tenant_id, invoice_id, event)

        # Route: GET /invoices
        if method == "GET":
            return _list_invoices(tenant_id, query_params, event)

        return bad_request("Unknown route", event=event)

    except ValueError as e:
        return bad_request(str(e), event=event)
    except Exception as e:
        print(f"[Invoices] Unexpected error: {e}")
        return error("Internal server error", event=event)


def _get_invoice(tenant_id: str, invoice_id: str, event: dict) -> dict:
    item = get_invoice(tenant_id, invoice_id)
    if not item:
        return not_found(f"Invoice {invoice_id} not found", event=event)
    return success(item, event=event)


def _get_status(tenant_id: str, invoice_id: str, event: dict) -> dict:
    """Return the processing status of an invoice."""
    # First check DynamoDB invoices table
    item = get_invoice(tenant_id, invoice_id)
    if item:
        return success({
            "invoice_id": invoice_id,
            "status": item.get("status", "UNKNOWN"),
            "risk_score": item.get("risk_score"),
            "risk_level": item.get("risk_level"),
            "processing_time_ms": item.get("processing_time_ms"),
        }, event=event)

    # If not in invoices table yet, check processing_jobs
    job = get_job(f"job_{invoice_id}")
    if job:
        return success({
            "invoice_id": invoice_id,
            "status": job.get("status", "PENDING"),
            "stage": job.get("stage"),
            "error_message": job.get("error_message"),
        }, event=event)

    return not_found(f"Invoice {invoice_id} not found", event=event)


def _list_invoices(tenant_id: str, query_params: dict, event: dict) -> dict:
    status = query_params.get("status")
    risk_level = query_params.get("risk_level")
    limit = min(int(query_params.get("page_size", "20")), 100)

    # Decode cursor for DynamoDB pagination
    last_key = None
    cursor = query_params.get("cursor")
    if cursor:
        try:
            last_key = json.loads(base64.b64decode(cursor).decode())
        except Exception:
            return bad_request("Invalid pagination cursor", event=event)

    result = list_invoices(
        tenant_id=tenant_id,
        status=status,
        risk_level=risk_level,
        limit=limit,
        last_key=last_key,
    )

    # Encode next cursor
    next_cursor = None
    if result.get("last_key"):
        next_cursor = base64.b64encode(
            json.dumps(result["last_key"]).encode()
        ).decode()

    return success({
        "items": result["items"],
        "count": len(result["items"]),
        "next_cursor": next_cursor,
    }, event=event)


def _delete_invoice(tenant_id: str, invoice_id: str, event: dict) -> dict:
    item = get_invoice(tenant_id, invoice_id)
    if not item:
        return not_found(f"Invoice {invoice_id} not found", event=event)

    # Delete S3 object
    s3_key = item.get("s3_key")
    if s3_key and UPLOADS_BUCKET:
        try:
            s3.delete_object(Bucket=UPLOADS_BUCKET, Key=s3_key)
        except ClientError as e:
            print(f"[Invoices] Warning: could not delete S3 object: {e}")

    delete_invoice(tenant_id, invoice_id)

    return success({"deleted": True, "invoice_id": invoice_id}, event=event)
