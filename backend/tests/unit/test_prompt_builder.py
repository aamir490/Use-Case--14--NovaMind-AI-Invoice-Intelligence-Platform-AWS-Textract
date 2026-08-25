"""
Unit tests for the AI prompt builder.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../lambdas/ai_analysis"))

from prompt_builder import build_analysis_prompt


def test_prompt_contains_invoice_fields():
    invoice_data = {
        "invoice_number": "INV-001",
        "vendor_name": "ACME Corp",
        "receipt_date": "2024-01-15",
        "due_date": "2024-02-15",
        "total_amount": "$500.00",
        "subtotal": "$450.00",
        "tax": "$50.00",
        "line_items": [{"item": "Widget", "price": "$450.00", "quantity": "1"}],
    }
    text_lines = ["Invoice #INV-001", "ACME Corp", "Total: $500.00"]
    prompt = build_analysis_prompt(text_lines, invoice_data)

    assert "INV-001" in prompt
    assert "ACME Corp" in prompt
    assert "$500.00" in prompt
    assert "Widget" in prompt


def test_prompt_requests_json_output():
    prompt = build_analysis_prompt([], {})
    assert "JSON" in prompt
    assert "anomalies" in prompt
    assert "severity" in prompt
    assert "confidence" in prompt


def test_prompt_lists_anomaly_types():
    prompt = build_analysis_prompt([], {})
    assert "MATH_ERROR" in prompt
    assert "DATE_INCONSISTENCY" in prompt
    assert "UNUSUAL_PRICE" in prompt


def test_prompt_handles_empty_line_items():
    invoice_data = {"line_items": []}
    prompt = build_analysis_prompt([], invoice_data)
    assert isinstance(prompt, str)
    assert len(prompt) > 100


def test_prompt_handles_none_values():
    invoice_data = {
        "invoice_number": None,
        "vendor_name": None,
        "total_amount": None,
        "line_items": [],
    }
    prompt = build_analysis_prompt([], invoice_data)
    assert "N/A" in prompt


def test_prompt_includes_raw_text():
    text_lines = ["Line 1", "Line 2", "Total: $100"]
    prompt = build_analysis_prompt(text_lines, {})
    assert "Line 1" in prompt
    assert "Line 2" in prompt
    assert "Total: $100" in prompt
