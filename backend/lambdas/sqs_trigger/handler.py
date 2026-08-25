"""
SQS Trigger Lambda — Bridge between SQS and Step Functions.

S3 PUT → SQS → this Lambda → Step Functions execution

When an invoice is uploaded to S3, S3 sends an event to SQS.
This Lambda reads the SQS message and starts a Step Functions execution
with the correct PipelinePayload structure.

Environment variables (set by CDK):
  STATE_MACHINE_ARN - ARN of the Step Functions state machine
  UPLOADS_BUCKET    - S3 uploads bucket name
  JOBS_TABLE        - DynamoDB jobs table name
"""
import json
import os
import sys
import boto3
import uuid
from datetime import datetime
from botocore.exceptions import ClientError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.db import create_job, update_job_status

STATE_MACHINE_ARN = os.environ.get("STATE_MACHINE_ARN", "")
UPLOADS_BUCKET = os.environ.get("UPLOADS_BUCKET", "")

sfn = boto3.client("stepfunctions")


def handler(event: dict, context) -> dict:
    """
    Process SQS messages. Each message contains an S3 event notification.
    One S3 upload = one SQS message = one Step Functions execution.
    """
    processed = 0
    failed = 0

    for record in event.get("Records", []):
        try:
            _process_record(record)
            processed += 1
        except Exception as e:
            print(f"[SQSTrigger] Failed to process record: {e}")
            failed += 1
            # Re-raise to move message to DLQ after max retries
            raise

    print(f"[SQSTrigger] Processed {processed} records, {failed} failed")
    return {"processed": processed, "failed": failed}


def _process_record(record: dict):
    """Extract S3 info from SQS record and start Step Functions execution."""
    body = json.loads(record["body"])

    # SQS message body is an S3 event notification
    s3_records = body.get("Records", [])
    if not s3_records:
        print("[SQSTrigger] No S3 records in SQS message body, skipping")
        return

    s3_record = s3_records[0]
    bucket = s3_record["s3"]["bucket"]["name"]
    s3_key = s3_record["s3"]["object"]["key"]

    print(f"[SQSTrigger] New upload: s3://{bucket}/{s3_key}")

    # Skip processed-text files (safety net, same as original lambda)
    if s3_key.startswith("processed-text/"):
        print(f"[SQSTrigger] Skipping processed-text file: {s3_key}")
        return

    # Extract tenant_id from S3 key structure: invoices/{tenant_id}/{invoice_id}.ext
    parts = s3_key.split("/")
    if len(parts) >= 3 and parts[0] == "invoices":
        tenant_id = parts[1]
        filename = parts[2]
        invoice_id = filename.rsplit(".", 1)[0]  # strip extension
    else:
        # Fallback for files uploaded without tenant prefix
        tenant_id = "system"
        invoice_id = f"inv_{datetime.utcnow().strftime('%Y%m%d')}_{uuid.uuid4().hex[:8]}"
        print(f"[SQSTrigger] Non-standard key format. Using fallback invoice_id={invoice_id}")

    job_id = f"job_{invoice_id}"

    # Create job record if not already created by the upload API
    try:
        create_job(job_id, invoice_id, tenant_id)
    except Exception:
        # Job may already exist if created by the upload API Lambda
        pass

    # Build the initial pipeline payload
    payload = {
        "invoice_id": invoice_id,
        "tenant_id": tenant_id,
        "s3_key": s3_key,
        "bucket": bucket,
        "job_id": job_id,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    # Start Step Functions execution
    execution_name = f"{invoice_id}-{uuid.uuid4().hex[:6]}"
    try:
        response = sfn.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            name=execution_name,
            input=json.dumps(payload),
        )
        print(f"[SQSTrigger] Started execution: {response['executionArn']}")
        update_job_status(job_id, "PROCESSING", "STARTED")
    except ClientError as e:
        error_msg = f"Failed to start Step Functions: {e.response['Error']['Message']}"
        print(f"[SQSTrigger] {error_msg}")
        update_job_status(job_id, "FAILED", "TRIGGER", error_msg)
        raise
