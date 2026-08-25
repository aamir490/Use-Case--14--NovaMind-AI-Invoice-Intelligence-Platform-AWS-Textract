"""
Unit tests for the Textract response parser.
Tests use a minimal mock Textract response — no AWS calls needed.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../lambdas/ocr"))

from parser import parse_expense_document


def _make_textract_response(summary_fields=None, line_item_groups=None, blocks=None):
    """Build a minimal Textract AnalyzeExpense response for testing."""
    return {
        "ExpenseDocuments": [
            {
                "SummaryFields": summary_fields or [],
                "LineItemGroups": line_item_groups or [],
                "Blocks": blocks or [],
            }
        ]
    }


def _summary_field(field_type, value):
    return {
        "Type": {"Text": field_type},
        "ValueDetection": {"Text": value},
    }


def _line_item(item_text, price_text, qty_text=None):
    fields = [
        {"Type": {"Text": "ITEM"}, "ValueDetection": {"Text": item_text}},
        {"Type": {"Text": "PRICE"}, "ValueDetection": {"Text": price_text}},
    ]
    if qty_text:
        fields.append({"Type": {"Text": "QUANTITY"}, "ValueDetection": {"Text": qty_text}})
    return {"LineItemExpenseFields": fields}


# ── Summary field extraction ──────────────────────────────────────────────────

def test_extracts_invoice_number():
    response = _make_textract_response(
        summary_fields=[_summary_field("INVOICE_RECEIPT_ID", "INV-12345")]
    )
    data, _ = parse_expense_document(response)
    assert data["invoice_number"] == "INV-12345"
    assert data["invoice_id"] == "INV-12345"


def test_extracts_dates():
    response = _make_textract_response(
        summary_fields=[
            _summary_field("INVOICE_RECEIPT_DATE", "2024-01-15"),
            _summary_field("DUE_DATE", "2024-02-15"),
        ]
    )
    data, _ = parse_expense_document(response)
    assert data["receipt_date"] == "2024-01-15"
    assert data["due_date"] == "2024-02-15"


def test_extracts_total_and_vendor():
    response = _make_textract_response(
        summary_fields=[
            _summary_field("TOTAL", "$1,234.56"),
            _summary_field("VENDOR_NAME", "ACME Corp"),
        ]
    )
    data, _ = parse_expense_document(response)
    assert data["total_amount"] == "$1,234.56"
    assert data["vendor_name"] == "ACME Corp"


def test_extracts_subtotal_and_tax():
    response = _make_textract_response(
        summary_fields=[
            _summary_field("SUBTOTAL", "$1,100.00"),
            _summary_field("TAX", "$134.56"),
        ]
    )
    data, _ = parse_expense_document(response)
    assert data["subtotal"] == "$1,100.00"
    assert data["tax"] == "$134.56"


# ── Line item extraction ──────────────────────────────────────────────────────

def test_extracts_line_items():
    response = _make_textract_response(
        line_item_groups=[
            {
                "LineItems": [
                    _line_item("Widget A", "$50.00", "2"),
                    _line_item("Widget B", "$30.00"),
                ]
            }
        ]
    )
    data, _ = parse_expense_document(response)
    assert len(data["line_items"]) == 2
    assert data["line_items"][0]["item"] == "Widget A"
    assert data["line_items"][0]["price"] == "$50.00"
    assert data["line_items"][0]["quantity"] == "2"
    assert data["line_items"][1]["quantity"] == ""


def test_empty_line_items():
    response = _make_textract_response()
    data, _ = parse_expense_document(response)
    assert data["line_items"] == []


# ── Text lines extraction ─────────────────────────────────────────────────────

def test_extracts_text_lines():
    blocks = [
        {"BlockType": "LINE", "Text": "Invoice #INV-001"},
        {"BlockType": "LINE", "Text": "Total: $100.00"},
        {"BlockType": "WORD", "Text": "ignored"},
    ]
    response = _make_textract_response(blocks=blocks)
    _, lines = parse_expense_document(response)
    assert "Invoice #INV-001" in lines
    assert "Total: $100.00" in lines
    assert "ignored" not in lines


def test_blank_lines_are_skipped():
    blocks = [
        {"BlockType": "LINE", "Text": "  "},
        {"BlockType": "LINE", "Text": "Valid line"},
    ]
    response = _make_textract_response(blocks=blocks)
    _, lines = parse_expense_document(response)
    assert lines == ["Valid line"]


# ── Edge cases ────────────────────────────────────────────────────────────────

def test_empty_response_returns_defaults():
    data, lines = parse_expense_document({"ExpenseDocuments": []})
    assert data["invoice_number"] is None
    assert data["line_items"] == []
    assert lines == []


def test_missing_expense_documents_key():
    data, lines = parse_expense_document({})
    assert data["invoice_number"] is None
    assert lines == []
