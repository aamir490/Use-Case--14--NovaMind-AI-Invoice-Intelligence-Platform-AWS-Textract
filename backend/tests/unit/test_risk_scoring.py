"""
Unit tests for the risk scoring rules engine.
No AWS credentials needed — pure Python logic tests.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../lambdas/risk_scoring"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../lambdas/shared"))

from rules import (
    check_math_error,
    check_missing_fields,
    check_duplicate_line_items,
    calculate_risk_score,
)


# ── check_math_error ──────────────────────────────────────────────────────────

def test_math_error_detected_when_sum_differs():
    invoice = {
        "total_amount": "$100.00",
        "line_items": [{"item": "Widget", "price": "$50.00"}, {"item": "Gadget", "price": "$30.00"}],
    }
    has_error, desc = check_math_error(invoice)
    assert has_error is True
    assert "80.00" in desc or "100.00" in desc


def test_no_math_error_when_sum_matches():
    invoice = {
        "total_amount": "$80.00",
        "line_items": [{"item": "Widget", "price": "$50.00"}, {"item": "Gadget", "price": "$30.00"}],
    }
    has_error, _ = check_math_error(invoice)
    assert has_error is False


def test_math_error_allows_1_percent_rounding_tolerance():
    invoice = {
        "total_amount": "$100.00",
        "line_items": [{"item": "Widget", "price": "$99.50"}],
    }
    has_error, _ = check_math_error(invoice)
    assert has_error is False  # 0.5% difference — within tolerance


def test_no_math_error_when_total_missing():
    invoice = {"total_amount": None, "line_items": [{"item": "Widget", "price": "$50.00"}]}
    has_error, _ = check_math_error(invoice)
    assert has_error is False


def test_no_math_error_when_line_items_empty():
    invoice = {"total_amount": "$100.00", "line_items": []}
    has_error, _ = check_math_error(invoice)
    assert has_error is False


# ── check_missing_fields ──────────────────────────────────────────────────────

def test_missing_fields_all_present():
    invoice = {
        "invoice_number": "INV-001",
        "receipt_date": "2024-01-15",
        "total_amount": "$100.00",
        "vendor_name": "ACME Corp",
    }
    missing = check_missing_fields(invoice)
    assert missing == []


def test_missing_fields_detects_absent_keys():
    invoice = {"invoice_number": "INV-001"}
    missing = check_missing_fields(invoice)
    assert "receipt_date" in missing
    assert "total_amount" in missing
    assert "vendor_name" in missing


def test_missing_fields_detects_none_values():
    invoice = {
        "invoice_number": None,
        "receipt_date": "2024-01-15",
        "total_amount": "$100.00",
        "vendor_name": "ACME",
    }
    missing = check_missing_fields(invoice)
    assert "invoice_number" in missing


# ── check_duplicate_line_items ────────────────────────────────────────────────

def test_duplicate_line_items_detected():
    invoice = {
        "line_items": [
            {"item": "Widget", "price": "$10.00"},
            {"item": "Widget", "price": "$10.00"},
        ]
    }
    assert check_duplicate_line_items(invoice) is True


def test_no_duplicate_line_items():
    invoice = {
        "line_items": [
            {"item": "Widget", "price": "$10.00"},
            {"item": "Gadget", "price": "$20.00"},
        ]
    }
    assert check_duplicate_line_items(invoice) is False


def test_duplicate_check_is_case_insensitive():
    invoice = {
        "line_items": [
            {"item": "WIDGET", "price": "$10.00"},
            {"item": "widget", "price": "$10.00"},
        ]
    }
    assert check_duplicate_line_items(invoice) is True


def test_empty_line_items_no_duplicate():
    invoice = {"line_items": []}
    assert check_duplicate_line_items(invoice) is False


# ── calculate_risk_score ──────────────────────────────────────────────────────

def test_clean_invoice_scores_low():
    invoice = {
        "invoice_number": "INV-001",
        "receipt_date": "2024-01-15",
        "total_amount": "$80.00",
        "vendor_name": "ACME Corp",
        "line_items": [{"item": "Widget", "price": "$80.00"}],
    }
    score, level = calculate_risk_score(invoice, [])
    assert score < 30
    assert level == "LOW"


def test_math_error_alone_produces_medium_or_high():
    invoice = {
        "invoice_number": "INV-001",
        "receipt_date": "2024-01-15",
        "total_amount": "$100.00",
        "vendor_name": "ACME",
        "line_items": [{"item": "Widget", "price": "$50.00"}],
    }
    score, level = calculate_risk_score(invoice, [])
    assert score >= 40
    assert level in ("MEDIUM", "HIGH")


def test_high_severity_ai_anomaly_increases_score():
    invoice = {
        "invoice_number": "INV-001",
        "receipt_date": "2024-01-15",
        "total_amount": "$80.00",
        "vendor_name": "ACME",
        "line_items": [{"item": "Widget", "price": "$80.00"}],
    }
    anomalies = [
        {"type": "UNUSUAL_PRICE", "severity": "HIGH", "description": "Price 10x market rate", "field": "Widget"},
        {"type": "TAX_IRREGULARITY", "severity": "HIGH", "description": "Tax exceeds legal limit", "field": "tax"},
        {"type": "DATE_INCONSISTENCY", "severity": "HIGH", "description": "Due date before receipt", "field": "due_date"},
        {"type": "OTHER", "severity": "HIGH", "description": "Suspicious pattern", "field": None},
        {"type": "OTHER", "severity": "HIGH", "description": "Another flag", "field": None},
    ]
    score, level = calculate_risk_score(invoice, anomalies)
    assert level == "HIGH"
    assert score >= 70


def test_score_capped_at_100():
    invoice = {
        "invoice_number": None,
        "receipt_date": None,
        "total_amount": "$100.00",
        "vendor_name": None,
        "line_items": [{"item": "x", "price": "$50.00"}, {"item": "x", "price": "$50.00"}],
    }
    many_anomalies = [{"type": "OTHER", "severity": "HIGH", "description": "x", "field": None}] * 20
    score, _ = calculate_risk_score(invoice, many_anomalies)
    assert score == 100


def test_risk_level_bands():
    invoice = {"invoice_number": "INV-1", "receipt_date": "2024-01-01", "total_amount": "$10", "vendor_name": "V", "line_items": []}

    # LOW band: score < 30
    score, level = calculate_risk_score(invoice, [])
    assert level == "LOW"

    # MEDIUM band: score 30–69
    medium_anomalies = [{"type": "OTHER", "severity": "HIGH", "description": "x", "field": None}] * 3
    score, level = calculate_risk_score(invoice, medium_anomalies)
    assert level in ("MEDIUM", "HIGH")
