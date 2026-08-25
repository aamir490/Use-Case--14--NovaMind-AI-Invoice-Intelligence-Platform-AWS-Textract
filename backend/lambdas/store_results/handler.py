"""
Store Results Lambda — Step 4 (final) of the invoice processing pipeline.

Writes the complete enriched invoice record to DynamoDB.
Saves the extracted text to S3.
Publishes an InvoiceProcessed event to EventBridge.
Updates the processing job status to COMPLETED.

Environment variables (set by CDK):
  INVOICES_TABLE       - DynamoDB invoices table name
  JOBS_TABLE           - DynamoDB processing jobs table name
  PROCESSED_BUCKET     - S3 bucket for extracted text files
  EVENTBRIDGE_BUS_NAME - EventBridge bus name
"""
import json
import os
import sys
import time
import boto3
from botocore.exceptions import ClientError
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.db import put_invoice, update_job_status

PROCESSED_BUCKET = os.environ.get("PROCESSED_BUCKET", "")
EVENTBRIDGE_BUS_NAME = os.environ.get("EVENTBRIDGE_BUS_NAME", "invoice-platform")

s3 = boto3.client("s3")
events_client = boto3.client("events")


def _save_text_to_s3(invoice_id: str, tenant_id: str, text_lines: list) -> str:
    """
    Save extracted text to S3. Returns the S3 key.
    Falls back to skipping if bucket is not configured.
    """
    if not PROCESSED_BUCKET or not text_lines:
        return ""

    key = f"processed-text/{tenant_id}/{invoice_id}.txt"
    content = "\n".join(text_lines)

    try:
        s3.put_object(Bucket=PROCESSED_BUCKET, Key=key, Body=content, ContentType="text/plain")
        print(f"[Store] Saved text to s3://{PROCESSED_BUCKET}/{key}")
        return key
    except ClientError as e:
        print(f"[Store] Warning: Could not save text to S3: {e.response['Error']['Message']}")
        return ""


def _publish_event(invoice_id: str, tenant_id: str, risk_score: int, risk_level: str):
    """Publish an InvoiceProcessed event to EventBridge."""
    try:
        events_client.put_events(Entries=[{
            "Source": "invoice-platform",
            "DetailType": "InvoiceProcessed",
            "EventBusName": EVENTBRIDGE_BUS_NAME,
            "Detail": json.dumps({
                "invoice_id": invoice_id,
                "tenant_id": tenant_id,
                "risk_score": risk_score,
                "risk_level": risk_level,
                "processed_at": datetime.utcnow().isoformat() + "Z",
            }),
        }])
        print(f"[Store] Published InvoiceProcessed event | risk_level={risk_level}")
    except ClientError as e:
        # Non-fatal — don't fail the pipeline for a notification issue
        print(f"[Store] Warning: Could not publish EventBridge event: {e.response['Error']['Message']}")


def handler(event: dict, context) -> dict:
    """
    Input:  complete PipelinePayload with ocr_data, ai_result, risk_score, risk_level
    Output: final invoice record (also written to DynamoDB)
    """
    invoice_id = event["invoice_id"]
    tenant_id = event["tenant_id"]
    s3_key = event["s3_key"]
    job_id = event["job_id"]
    ocr_data = event.get("ocr_data", {})
    ai_result = event.get("ai_result", {})
    risk_score = event.get("risk_score", 0)
    risk_level = event.get("risk_level", "LOW")
    all_anomalies = event.get("all_anomalies", [])

    print(f"[Store] Storing results for invoice {invoice_id} | risk={risk_level}({risk_score})")
    update_job_status(job_id, "PROCESSING", "STORING")

    start = time.time()

    # Save extracted text to S3
    text_lines = ocr_data.get("text_lines", [])
    processed_text_key = _save_text_to_s3(invoice_id, tenant_id, text_lines)

    now = datetime.utcnow().isoformat() + "Z"

    # Calculate total processing time across all stages
    total_time_ms = (
        ocr_data.get("ocr_time_ms", 0)
        + ai_result.get("ai_time_ms", 0)
        + int((time.time() - start) * 1000)
    )

    # Build the final DynamoDB record
    invoice_record = {
        "tenant_id": tenant_id,
        "invoice_id": invoice_id,
        "invoice_number": ocr_data.get("invoice_number"),
        "vendor_name": ocr_data.get("vendor_name"),
        "due_date": ocr_data.get("due_date"),
        "receipt_date": ocr_data.get("receipt_date"),
        "total_amount": ocr_data.get("total_amount"),
        "subtotal": ocr_data.get("subtotal"),
        "tax": ocr_data.get("tax"),
        "currency": ocr_data.get("currency", "USD"),
        "line_items": ocr_data.get("line_items", []),
        "status": "COMPLETED",
        "risk_score": risk_score,
        "risk_level": risk_level,
        "anomalies": all_anomalies,
        "ai_explanation": ai_result.get("summary", ""),
        "ai_confidence": str(ai_result.get("confidence", 0.0)),
        "s3_key": s3_key,
        "processed_text_s3_key": processed_text_key,
        "job_id": job_id,
        "created_at": event.get("created_at", now),
        "processed_at": now,
        "processing_time_ms": total_time_ms,
    }

    # Write to DynamoDB
    put_invoice(invoice_record)

    # Update job to COMPLETED
    update_job_status(job_id, "COMPLETED", "DONE")

    # Publish event (for SNS high-risk alerts and future integrations)
    _publish_event(invoice_id, tenant_id, risk_score, risk_level)

    print(f"[Store] Done | invoice_id={invoice_id} | total_time={total_time_ms}ms")

    return {
        "invoice_id": invoice_id,
        "tenant_id": tenant_id,
        "status": "COMPLETED",
        "risk_score": risk_score,
        "risk_level": risk_level,
        "anomaly_count": len(all_anomalies),
        "processing_time_ms": total_time_ms,
    }
