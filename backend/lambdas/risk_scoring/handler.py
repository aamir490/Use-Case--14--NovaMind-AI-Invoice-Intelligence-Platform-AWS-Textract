"""
Risk Scoring Lambda — Step 3 of the invoice processing pipeline.

Combines deterministic business rules with AI anomaly output
to produce a numeric risk score (0–100) and a risk level (LOW/MEDIUM/HIGH).

No external AWS calls are made here — pure computation.

Environment variables (set by CDK):
  JOBS_TABLE - DynamoDB table for processing job status
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.db import update_job_status
from rules import calculate_risk_score, check_math_error, check_missing_fields, check_duplicate_line_items


def handler(event: dict, context) -> dict:
    """
    Input:  PipelinePayload with ocr_data and ai_result populated
    Output: same dict + risk_score + risk_level + enriched_anomalies
    """
    invoice_id = event["invoice_id"]
    job_id = event["job_id"]
    ocr_data = event.get("ocr_data", {})
    ai_result = event.get("ai_result", {})

    print(f"[RiskScoring] Scoring invoice {invoice_id}")
    update_job_status(job_id, "PROCESSING", "RISK_SCORING")

    ai_anomalies = ai_result.get("anomalies", [])
    start = time.time()

    # Calculate score
    risk_score, risk_level = calculate_risk_score(ocr_data, ai_anomalies)

    # Build enriched anomaly list — combine AI findings with deterministic findings
    all_anomalies = list(ai_anomalies)  # copy

    # Add deterministic anomalies that the AI might have missed
    has_math_error, math_desc = check_math_error(ocr_data)
    if has_math_error:
        all_anomalies.insert(0, {
            "type": "MATH_ERROR",
            "severity": "HIGH",
            "description": math_desc,
            "field": "total_amount",
        })

    missing_fields = check_missing_fields(ocr_data)
    for field in missing_fields:
        # Only add if AI didn't already flag it
        already_flagged = any(
            a.get("field") == field and a.get("type") == "MISSING_FIELD"
            for a in ai_anomalies
        )
        if not already_flagged:
            all_anomalies.append({
                "type": "MISSING_FIELD",
                "severity": "MEDIUM",
                "description": f"Required field '{field}' is missing from the invoice",
                "field": field,
            })

    if check_duplicate_line_items(ocr_data):
        all_anomalies.append({
            "type": "DUPLICATE_ITEM",
            "severity": "MEDIUM",
            "description": "Duplicate line items detected in invoice",
            "field": "line_items",
        })

    elapsed_ms = int((time.time() - start) * 1000)
    print(f"[RiskScoring] score={risk_score} level={risk_level} | {elapsed_ms}ms")

    return {
        **event,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "all_anomalies": all_anomalies,
    }
