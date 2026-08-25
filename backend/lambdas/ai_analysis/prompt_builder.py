"""
Builds structured prompts for Bedrock invoice anomaly detection.
Designed to return JSON so the output is machine-readable, not free text.
"""
from typing import List


def build_analysis_prompt(text_lines: List[str], invoice_data: dict) -> str:
    """
    Build the prompt sent to Bedrock.
    The prompt instructs the model to return strictly valid JSON only.
    """
    invoice_text = "\n".join(text_lines)

    # Include key structured fields so the model has clean data alongside raw text
    structured_summary = f"""
Invoice Number : {invoice_data.get('invoice_number', 'N/A')}
Vendor         : {invoice_data.get('vendor_name', 'N/A')}
Receipt Date   : {invoice_data.get('receipt_date', 'N/A')}
Due Date       : {invoice_data.get('due_date', 'N/A')}
Total Amount   : {invoice_data.get('total_amount', 'N/A')}
Subtotal       : {invoice_data.get('subtotal', 'N/A')}
Tax            : {invoice_data.get('tax', 'N/A')}
Line Items     :
""" + "\n".join(
        f"  - {li.get('item', '')} | Price: {li.get('price', '')} | Qty: {li.get('quantity', '')}"
        for li in invoice_data.get("line_items", [])
    )

    prompt = f"""You are an expert invoice auditor and fraud detection specialist.
Analyze the invoice data below and identify any anomalies, inconsistencies, or suspicious patterns.

STRUCTURED DATA:
{structured_summary}

RAW INVOICE TEXT:
{invoice_text}

Return ONLY a valid JSON object — no explanation, no markdown, no code fences. Use exactly this schema:
{{
  "anomalies": [
    {{
      "type": "<MATH_ERROR|DATE_INCONSISTENCY|UNUSUAL_PRICE|NON_STANDARD_FORMAT|TAX_IRREGULARITY|DUPLICATE_ITEM|MISSING_FIELD|OTHER>",
      "severity": "<LOW|MEDIUM|HIGH>",
      "description": "<specific finding in plain English, max 100 chars>",
      "field": "<the field or line item name affected, or null>"
    }}
  ],
  "summary": "<2-3 sentence summary of all findings, or 'No anomalies detected.' if clean>",
  "confidence": <0.0 to 1.0 float>
}}

Rules:
- If no anomalies are found, return an empty anomalies array.
- Do not invent anomalies. Only flag what you can clearly see in the data.
- confidence reflects how sure you are about the overall assessment (1.0 = very sure).
"""
    return prompt
