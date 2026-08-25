"""
pytest configuration and shared fixtures for unit tests.
Sets required environment variables before any imports touch boto3.
"""
import os
import pytest

# Set env vars before any Lambda handler is imported
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
os.environ.setdefault("INVOICES_TABLE", "invoices")
os.environ.setdefault("JOBS_TABLE", "processing_jobs")
os.environ.setdefault("UPLOADS_BUCKET", "test-uploads-bucket")
os.environ.setdefault("PROCESSED_BUCKET", "test-processed-bucket")
os.environ.setdefault("BEDROCK_MODEL_ID", "us.amazon.nova-micro-v1:0")
os.environ.setdefault("STATE_MACHINE_ARN", "arn:aws:states:us-east-1:123456789012:stateMachine:test")
os.environ.setdefault("EVENTBRIDGE_BUS_NAME", "invoice-platform")
