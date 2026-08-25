"""
AI Analysis Lambda — Step 2 of the invoice processing pipeline.

Calls Amazon Bedrock (Nova Micro) with a structured prompt.
Returns a machine-readable JSON anomaly report.

Environment variables (set by CDK):
  BEDROCK_MODEL_ID  - Model ID (default: us.amazon.nova-micro-v1:0)
  JOBS_TABLE        - DynamoDB table for processing job status
"""
import json
import os
import sys
import time
import random
import boto3
from botocore.exceptions import ClientError
from threading import Lock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.db import update_job_status
from shared.exceptions import AIAnalysisError, RateLimitExceededError
from prompt_builder import build_analysis_prompt

BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-micro-v1:0")
MAX_RETRIES = 4

bedrock_runtime = boto3.client("bedrock-runtime")

# ── Rate limiter (same logic as original lambda_function.py) ──────────────────
class RateLimiter:
    def __init__(self, max_per_minute: int):
        self.max_requests = max_per_minute
        self.requests = []
        self.lock = Lock()

    def wait_if_needed(self):
        with self.lock:
            now = time.time()
            self.requests = [t for t in self.requests if now - t < 60]
            if len(self.requests) >= self.max_requests:
                sleep_time = 60 - (now - self.requests[0])
                if sleep_time > 0:
                    print(f"[AI] Rate limit reached. Sleeping {sleep_time:.1f}s")
                    time.sleep(sleep_time)
            self.requests.append(now)


_rate_limiter = RateLimiter(max_per_minute=10)


def _invoke_with_retry(prompt: str) -> str:
    """Call Bedrock and return the raw text response. Retries on throttling."""
    body = json.dumps({
        "inferenceConfig": {
            "maxTokens": 1500,
            "temperature": 0.2,   # lower = more deterministic JSON output
            "topP": 0.9,
        },
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
    })

    for attempt in range(MAX_RETRIES + 1):
        try:
            _rate_limiter.wait_if_needed()
            response = bedrock_runtime.invoke_model(modelId=BEDROCK_MODEL_ID, body=body)
            response_body = json.loads(response["body"].read())
            return response_body["output"]["message"]["content"][0]["text"]
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code == "ThrottlingException":
                if "tokens per day" in str(e).lower():
                    raise RateLimitExceededError("Daily Bedrock token quota exceeded") from e
                if attempt < MAX_RETRIES:
                    wait = (2 ** attempt) + random.uniform(0, 1)
                    print(f"[AI] Throttled. Retry {attempt+1}/{MAX_RETRIES} after {wait:.1f}s")
                    time.sleep(wait)
                    continue
            raise AIAnalysisError(f"Bedrock error [{code}]: {str(e)}") from e

    raise AIAnalysisError("Max retries exceeded calling Bedrock")


def _parse_json_response(raw_text: str) -> dict:
    """
    Extract JSON from the model response.
    The model is instructed to return only JSON, but may still wrap it in markdown.
    """
    text = raw_text.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if len(lines) > 2 else text

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON object within the text as a fallback
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass

    # If we still can't parse, return a safe default rather than failing the pipeline
    print(f"[AI] Warning: Could not parse JSON from Bedrock response. Raw: {raw_text[:200]}")
    return {
        "anomalies": [],
        "summary": "AI analysis could not be parsed. Manual review recommended.",
        "confidence": 0.0,
    }


def handler(event: dict, context) -> dict:
    """
    Input:  PipelinePayload with ocr_data populated
    Output: same dict + ai_result (anomalies, summary, confidence)
    """
    invoice_id = event["invoice_id"]
    job_id = event["job_id"]
    ocr_data = event.get("ocr_data", {})

    print(f"[AI] Analyzing invoice {invoice_id}")
    update_job_status(job_id, "PROCESSING", "AI_ANALYSIS")

    text_lines = ocr_data.get("text_lines", [])
    if not text_lines:
        print("[AI] Warning: No text lines from OCR. Using empty prompt.")

    start = time.time()

    try:
        prompt = build_analysis_prompt(text_lines, ocr_data)
        raw_response = _invoke_with_retry(prompt)
        ai_result = _parse_json_response(raw_response)
    except (RateLimitExceededError, AIAnalysisError) as e:
        # Non-fatal: pipeline continues with empty AI result
        print(f"[AI] Analysis failed (non-fatal): {e}")
        ai_result = {
            "anomalies": [],
            "summary": f"AI analysis unavailable: {str(e)}",
            "confidence": 0.0,
        }

    elapsed_ms = int((time.time() - start) * 1000)
    print(f"[AI] Completed in {elapsed_ms}ms | anomalies found: {len(ai_result.get('anomalies', []))}")

    return {
        **event,
        "ai_result": {
            **ai_result,
            "ai_time_ms": elapsed_ms,
        },
    }
