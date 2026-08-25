"""
Deterministic business rules for risk scoring.
These run on top of the AI anomaly output to produce a numeric score 0–100.
"""
import re
from typing import List, Tuple


def check_math_error(invoice_data: dict) -> Tuple[bool, str]:
    """
    Check whether line item prices sum to the stated total.
    Returns (has_error, description).
    """
    total_str = invoice_data.get("total_amount", "") or ""
    line_items = invoice_data.get("line_items", [])

    if not total_str or not line_items:
        return False, ""

    def parse_amount(s: str) -> float:
        cleaned = re.sub(r"[^\d.]", "", str(s))
        try:
            return float(cleaned)
        except ValueError:
            return 0.0

    total = parse_amount(total_str)
    line_sum = sum(parse_amount(li.get("price", "0")) for li in line_items)

    if total > 0 and line_sum > 0:
        # Allow 1% tolerance for tax rounding
        diff_pct = abs(total - line_sum) / total
        if diff_pct > 0.01:
            return True, f"Line items sum to {line_sum:.2f} but stated total is {total:.2f}"

    return False, ""


def check_missing_fields(invoice_data: dict) -> List[str]:
    """Return list of important fields that are missing."""
    missing = []
    important_fields = ["invoice_number", "receipt_date", "total_amount", "vendor_name"]
    for field in important_fields:
        if not invoice_data.get(field):
            missing.append(field)
    return missing


def check_non_standard_invoice_number(invoice_data: dict) -> bool:
    """Check if the invoice number looks non-standard (e.g., only numbers, very short)."""
    inv_num = invoice_data.get("invoice_number", "") or ""
    if not inv_num:
        return False
    # Flag if purely numeric and very short (likely a misread)
    if inv_num.isdigit() and len(inv_num) < 3:
        return True
    return False


def check_duplicate_line_items(invoice_data: dict) -> bool:
    """Check if the same item description appears more than once."""
    items = [li.get("item", "").strip().lower() for li in invoice_data.get("line_items", [])]
    return len(items) != len(set(items)) and len(items) > 0


def calculate_risk_score(invoice_data: dict, ai_anomalies: List[dict]) -> Tuple[int, str]:
    """
    Combine deterministic rules + AI anomalies into a risk score 0–100.

    Scoring bands:
      0–29  → LOW
      30–69 → MEDIUM
      70+   → HIGH

    Returns (score, risk_level)
    """
    score = 0

    # ── Deterministic rules ───────────────────────────────────────────
    has_math_error, _ = check_math_error(invoice_data)
    if has_math_error:
        score += 40  # hard red flag

    missing = check_missing_fields(invoice_data)
    score += len(missing) * 8  # up to 32 for all 4 missing

    if check_non_standard_invoice_number(invoice_data):
        score += 10

    if check_duplicate_line_items(invoice_data):
        score += 15

    # ── AI anomalies ──────────────────────────────────────────────────
    severity_scores = {"HIGH": 15, "MEDIUM": 7, "LOW": 3}
    for anomaly in ai_anomalies:
        score += severity_scores.get(anomaly.get("severity", "LOW"), 3)

    # Cap at 100
    score = min(score, 100)

    if score >= 70:
        risk_level = "HIGH"
    elif score >= 30:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    return score, risk_level
