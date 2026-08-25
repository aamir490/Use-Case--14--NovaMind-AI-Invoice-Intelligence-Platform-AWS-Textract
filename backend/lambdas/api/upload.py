"""
API Lambda — POST /invoices/upload-url

Returns a pre-signed S3 URL so the frontend can upload directly to S3.
Creates a processing_job record in DynamoDB with PENDING status.

Environment variables (set by CDK):
  UPLOADS_BUCKET - S3 bucket name for invoice uploads
  JOBS_TABLE     - DynamoDB processing jobs table
"""
import json
import os
import sys
import uuid
import boto3
from datetime import datetime
from botocore.exceptions import ClientError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.db import create_job
from shared.response import success, bad_request, error, get_tenant_id

UPLOADS_BUCKET = os.environ.get("UPLOADS_BUCKET", "")
PRESIGNED_URL_EXPIRY = 300  # 5 minutes

ALLOWED_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "application/pdf": ".pdf",
    "image/tiff": ".tiff",
}

s3 = boto3.client("s3")


def handler(event: dict, context) -> dict:
    try:
        tenant_id = get_tenant_id(event)
        body = json.loads(event.get("body") or "{}")

        content_type = body.get("content_type", "image/png")
        filename = body.get("filename", "invoice.png")

        if content_type not in ALLOWED_CONTENT_TYPES:
            return bad_request(f"Unsupported content type '{content_type}'. Allowed: {list(ALLOWED_CONTENT_TYPES.keys())}")

        ext = ALLOWED_CONTENT_TYPES[content_type]
        date_prefix = datetime.utcnow().strftime("%Y%m%d")
        unique_id = uuid.uuid4().hex[:8]
        invoice_id = f"inv_{date_prefix}_{unique_id}"
        s3_key = f"invoices/{tenant_id}/{invoice_id}{ext}"

        # Create the processing job record
        job_id = f"job_{invoice_id}"
        create_job(job_id, invoice_id, tenant_id)

        # Generate pre-signed URL
        presigned_url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": UPLOADS_BUCKET,
                "Key": s3_key,
                "ContentType": content_type,
            },
            ExpiresIn=PRESIGNED_URL_EXPIRY,
        )

        print(f"[Upload] Pre-signed URL generated | invoice_id={invoice_id} | tenant={tenant_id}")

        return success({
            "invoice_id": invoice_id,
            "job_id": job_id,
            "upload_url": presigned_url,
            "s3_key": s3_key,
            "expires_in": PRESIGNED_URL_EXPIRY,
        }, status_code=201, event=event)

    except ValueError as e:
        return bad_request(str(e), event=event)
    except ClientError as e:
        print(f"[Upload] AWS error: {e}")
        return error(f"Failed to generate upload URL: {e.response['Error']['Message']}", event=event)
    except Exception as e:
        print(f"[Upload] Unexpected error: {e}")
        return error("Internal server error", event=event)
