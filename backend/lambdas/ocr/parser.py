"""
Textract response parser — extracted from the original lambda_function.py.
Converts the raw AnalyzeExpense response into a clean structured dict.
"""
from typing import List, Dict, Any, Tuple


def parse_expense_document(textract_response: dict) -> Tuple[dict, List[str]]:
    """
    Parse a Textract AnalyzeExpense response.

    Args:
        textract_response: Raw response from textract.analyze_expense()

    Returns:
        (invoice_data, text_lines)
        - invoice_data: structured dict with all extracted fields
        - text_lines: flat list of every LINE block text (used for AI prompt)
    """
    invoice_data: Dict[str, Any] = {
        "invoice_number": None,
        "invoice_id": None,
        "vendor_name": None,
        "due_date": None,
        "receipt_date": None,
        "total_amount": None,
        "subtotal": None,
        "tax": None,
        "currency": "USD",
        "line_items": [],
    }

    if not textract_response.get("ExpenseDocuments"):
        return invoice_data, []

    expense_doc = textract_response["ExpenseDocuments"][0]

    # ── Summary fields ──────────────────────────────────────────────────
    for field in expense_doc.get("SummaryFields", []):
        field_type = field.get("Type", {}).get("Text", "")
        value = field.get("ValueDetection", {}).get("Text", "")

        if field_type == "INVOICE_RECEIPT_ID":
            invoice_data["invoice_number"] = value
            invoice_data["invoice_id"] = value
        elif field_type == "DUE_DATE":
            invoice_data["due_date"] = value
        elif field_type == "INVOICE_RECEIPT_DATE":
            invoice_data["receipt_date"] = value
        elif field_type == "TOTAL":
            invoice_data["total_amount"] = value
        elif field_type == "SUBTOTAL":
            invoice_data["subtotal"] = value
        elif field_type == "TAX":
            invoice_data["tax"] = value
        elif field_type == "VENDOR_NAME":
            invoice_data["vendor_name"] = value

    # ── Line items ──────────────────────────────────────────────────────
    items: List[str] = []
    prices: List[str] = []
    quantities: List[str] = []

    for group in expense_doc.get("LineItemGroups", []):
        for line_item in group.get("LineItems", []):
            item_text = price_text = qty_text = None
            for expense_field in line_item.get("LineItemExpenseFields", []):
                ft = expense_field.get("Type", {}).get("Text", "")
                val = expense_field.get("ValueDetection", {}).get("Text", "")
                if ft == "ITEM":
                    item_text = val
                elif ft == "PRICE":
                    price_text = val
                elif ft == "QUANTITY":
                    qty_text = val
            if item_text or price_text:
                invoice_data["line_items"].append({
                    "item": item_text or "",
                    "price": price_text or "",
                    "quantity": qty_text or "",
                })

    # ── Raw text lines (for AI prompt) ──────────────────────────────────
    text_lines: List[str] = []
    for block in expense_doc.get("Blocks", []):
        if block.get("BlockType") == "LINE":
            text = block.get("Text", "").strip()
            if text:
                text_lines.append(text)

    return invoice_data, text_lines
