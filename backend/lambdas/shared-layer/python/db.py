"""
DynamoDB client and helper functions shared across Lambda functions.
"""
import os
import boto3
from boto3.dynamodb.conditions import Key, Attr
from botocore.exceptions import ClientError
from typing import Optional, List, Dict, Any
import json
from datetime import datetime

# Table names come from environment variables set by CDK
INVOICES_TABLE = os.environ.get("INVOICES_TABLE", "invoices")
JOBS_TABLE = os.environ.get("JOBS_TABLE", "processing_jobs")

dynamodb = boto3.resource("dynamodb")
invoices_table = dynamodb.Table(INVOICES_TABLE)
jobs_table = dynamodb.Table(JOBS_TABLE)


def put_invoice(item: dict) -> bool:
    """Write or overwrite an invoice record."""
    try:
        invoices_table.put_item(Item=item)
        print(f"[DB] Saved invoice {item.get('invoice_id')} for tenant {item.get('tenant_id')}")
        return True
    except ClientError as e:
        print(f"[DB] Error saving invoice: {e.response['Error']['Message']}")
        raise


def get_invoice(tenant_id: str, invoice_id: str) -> Optional[dict]:
    """Fetch a single invoice by composite key."""
    try:
        response = invoices_table.get_item(
            Key={"tenant_id": tenant_id, "invoice_id": invoice_id}
        )
        return response.get("Item")
    except ClientError as e:
        print(f"[DB] Error fetching invoice: {e.response['Error']['Message']}")
        raise


def list_invoices(
    tenant_id: str,
    status: Optional[str] = None,
    risk_level: Optional[str] = None,
    limit: int = 20,
    last_key: Optional[dict] = None,
) -> dict:
    """
    List invoices for a tenant with optional filters.
    Returns {'items': [...], 'last_key': ...}
    """
    kwargs: Dict[str, Any] = {
        "KeyConditionExpression": Key("tenant_id").eq(tenant_id),
        "Limit": limit,
        "ScanIndexForward": False,  # newest first
    }

    filter_parts = []
    if status:
        filter_parts.append(Attr("status").eq(status))
    if risk_level:
        filter_parts.append(Attr("risk_level").eq(risk_level))

    if filter_parts:
        combined = filter_parts[0]
        for part in filter_parts[1:]:
            combined = combined & part
        kwargs["FilterExpression"] = combined

    if last_key:
        kwargs["ExclusiveStartKey"] = last_key

    try:
        response = invoices_table.query(**kwargs)
        return {
            "items": response.get("Items", []),
            "last_key": response.get("LastEvaluatedKey"),
        }
    except ClientError as e:
        print(f"[DB] Error listing invoices: {e.response['Error']['Message']}")
        raise


def delete_invoice(tenant_id: str, invoice_id: str) -> bool:
    """Delete an invoice record."""
    try:
        invoices_table.delete_item(
            Key={"tenant_id": tenant_id, "invoice_id": invoice_id}
        )
        return True
    except ClientError as e:
        print(f"[DB] Error deleting invoice: {e.response['Error']['Message']}")
        raise


# ── Processing Jobs ───────────────────────────────────────────────

def create_job(job_id: str, invoice_id: str, tenant_id: str) -> bool:
    """Create a new processing job record."""
    try:
        now = datetime.utcnow().isoformat() + "Z"
        jobs_table.put_item(Item={
            "job_id": job_id,
            "invoice_id": invoice_id,
            "tenant_id": tenant_id,
            "status": "PENDING",
            "stage": "PENDING",
            "started_at": now,
            "updated_at": now,
        })
        return True
    except ClientError as e:
        print(f"[DB] Error creating job: {e.response['Error']['Message']}")
        raise


def update_job_status(job_id: str, status: str, stage: str, error_message: Optional[str] = None) -> bool:
    """Update the status of a processing job."""
    try:
        update_expr = "SET #status = :status, stage = :stage, updated_at = :updated"
        expr_names = {"#status": "status"}
        expr_values = {
            ":status": status,
            ":stage": stage,
            ":updated": datetime.utcnow().isoformat() + "Z",
        }
        if error_message:
            update_expr += ", error_message = :err"
            expr_values[":err"] = error_message

        jobs_table.update_item(
            Key={"job_id": job_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )
        return True
    except ClientError as e:
        print(f"[DB] Error updating job: {e.response['Error']['Message']}")
        raise


def get_job(job_id: str) -> Optional[dict]:
    """Fetch a processing job record."""
    try:
        response = jobs_table.get_item(Key={"job_id": job_id})
        return response.get("Item")
    except ClientError as e:
        print(f"[DB] Error fetching job: {e.response['Error']['Message']}")
        raise
