"""
OCR Lambda — Step 1 of the invoice processing pipeline.

Triggered by SQS (which is triggered by S3 PUT event).
Calls Textract AnalyzeExpense to extract structured data from the invoice image.
Returns structured data to Step Functions for the next stage.

Environment variables (set by CDK):
  UPLOADS_BUCKET   - S3 bucket name where invoices are uploaded
  JOBS_TABLE       - DynamoDB table for processing job status
"""
import json
import os
import sys
import boto3
import time
from botocore.exceptions import ClientError

# Allow importing from the shared package when running in Lambda
# In Lambda the /var/task directory is the package root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.db import update_job_status
from shared.exceptions import OCRError, UnsupportedFileTypeError
from parser import parse_expense_document

SUPPORTED_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif")
UPLOADS_BUCKET = os.environ.get("UPLOADS_BUCKET", "")

textract = boto3.client("textract")


def handler(event: dict, context) -> dict:
    """
    Step Functions passes the PipelinePayload dict as the event.

    Input:  { invoice_id, tenant_id, s3_key, job_id }
    Output: same dict + ocr_data (structured invoice fields + text_lines)
    """
    invoice_id = event["invoice_id"]
    tenant_id = event["tenant_id"]
    s3_key = event["s3_key"]
    job_id = event["job_id"]
    bucket = event.get("bucket", UPLOADS_BUCKET)

    print(f"[OCR] Processing {s3_key} | invoice_id={invoice_id} | tenant={tenant_id}")

    # Update job status
    update_job_status(job_id, "PROCESSING", "OCR")

    # Validate file type
    if not s3_key.lower().endswith(SUPPORTED_EXTENSIONS):
        ext = s3_key.rsplit(".", 1)[-1] if "." in s3_key else "unknown"
        raise UnsupportedFileTypeError(
            f"Unsupported file type '.{ext}'. Supported: {', '.join(SUPPORTED_EXTENSIONS)}"
        )

    start_time = time.time()

    try:
        response = textract.analyze_expense(
            Document={"S3Object": {"Bucket": bucket, "Name": s3_key}}
        )
    except ClientError as e:
        error_msg = f"Textract error: {e.response['Error']['Message']}"
        print(f"[OCR] {error_msg}")
        update_job_status(job_id, "FAILED", "OCR", error_msg)
        raise OCRError(error_msg) from e

    invoice_data, text_lines = parse_expense_document(response)

    # Use invoice_id from payload if Textract didn't find one in the document
    if not invoice_data.get("invoice_id"):
        invoice_data["invoice_id"] = invoice_id

    elapsed_ms = int((time.time() - start_time) * 1000)
    print(f"[OCR] Completed in {elapsed_ms}ms | fields extracted: {list(invoice_data.keys())}")

    return {
        **event,
        "ocr_data": {
            **invoice_data,
            "text_lines": text_lines,
            "ocr_time_ms": elapsed_ms,
        },
    }
