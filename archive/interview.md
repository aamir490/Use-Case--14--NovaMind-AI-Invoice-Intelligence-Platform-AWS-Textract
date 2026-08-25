# Interview Preparation — Serverless Invoice Processing & Anomaly Detection Pipeline

---

## 1. Tell me about this project in one line.

> "I built a fully serverless AWS pipeline that automatically reads invoice images using OCR, extracts structured data, runs AI-powered anomaly detection to find fraud or errors, and stores everything in a NoSQL database — with zero human intervention."

---

## 2. What problem does this project solve?

In real businesses, invoices come in as scanned images or photos. Manually reading each one to check for:
- Wrong totals
- Incorrect tax rates
- Suspicious item names
- Math errors in line items

...is slow, expensive, and error-prone.

This project **automates the entire audit process**:
- Upload an invoice image → pipeline runs automatically
- Within seconds you get structured data + an AI audit report in DynamoDB
- No human reads the invoice manually

---

## 3. Walk me through the architecture.

```
Invoice Image (PNG/JPG/PDF)
        |
        v
[S3 Source Bucket]  ── S3 PUT Event ──>  [AWS Lambda]
                                               |
              ┌────────────────────────────────┼──────────────────────────┐
              v                                v                          v
    [Amazon Textract]               [Amazon Bedrock]             [Amazon DynamoDB]
    AnalyzeExpense API              Nova Micro LLM               invoices table
    (OCR + Field Extraction)        (Anomaly Detection)          (Persistent Storage)
              |
              v
    [S3 Output Bucket]
    processed-text/ folder
    (.txt backup of extracted text)
```

**Step-by-step flow:**
1. User uploads an invoice image to the **S3 source bucket**
2. S3 PUT event **triggers Lambda automatically**
3. Lambda sends the image to **Amazon Textract** (`AnalyzeExpense` API)
4. Textract performs OCR and returns structured fields: invoice number, dates, totals, line items
5. Lambda sends the extracted text to **Amazon Bedrock** (Nova Micro model) asking it to detect inconsistencies and unusual charges
6. The AI analysis result is stored in **DynamoDB** alongside the structured invoice data
7. A `.txt` backup of the raw extracted text is saved to the **S3 output bucket**

---

## 4. What AWS services did you use and why?

| Service | Why I used it |
|---|---|
| **S3** | Durable object storage for invoice images + trigger mechanism via event notifications |
| **AWS Lambda** | Serverless compute — no servers to manage, pay only per execution, scales automatically |
| **Amazon Textract** | Purpose-built AWS OCR service with `AnalyzeExpense` API specifically designed for invoices and receipts |
| **Amazon Bedrock** | Managed LLM service — used Nova Micro model for cost-effective AI anomaly detection |
| **DynamoDB** | Serverless NoSQL database — flexible schema fits invoice data which varies by vendor |
| **CloudWatch** | Logs every step for debugging and monitoring |
| **IAM** | Least-privilege permissions for Lambda execution role |

---

## 5. Why did you choose Amazon Textract over regular OCR?

Regular OCR (like Tesseract) just extracts raw text. **Textract's `AnalyzeExpense` API** is purpose-built for financial documents. It:
- Understands invoice structure automatically
- Returns **labeled fields** like `INVOICE_RECEIPT_ID`, `DUE_DATE`, `TOTAL`, `LINE_ITEM`
- No custom model training needed
- Handles different invoice layouts from different vendors

---

## 6. Why DynamoDB instead of RDS (relational database)?

Invoices from different vendors have **different structures** — some have 3 line items, some have 30. Some have tax fields, some don't. A fixed SQL schema would require `NULL` columns everywhere or complex joins.

DynamoDB's **flexible schema** means:
- Each invoice record can have different attributes
- No schema migration needed when a new invoice format appears
- Serverless — no database instance to manage or pay for when idle
- Scales automatically with workload

---

## 7. What is Amazon Bedrock and why did you use Nova Micro?

**Amazon Bedrock** is a fully managed service that gives access to foundation models (LLMs) via API — without managing any ML infrastructure.

I used **Amazon Nova Micro** (`amazon.nova-micro-v1:0`) because:
- It's a lightweight, fast, cost-effective model
- Sufficient for text analysis tasks like anomaly detection on invoice text
- Lower latency than larger models — important for a real-time pipeline
- Available in Bedrock without custom deployment

---

## 8. How does the Lambda function work internally?

The Lambda function (`lambda_function.py`) does these steps:

1. **Reads the S3 event** — extracts bucket name and file key
2. **Skips re-trigger loops** — if file is under `processed-text/`, it ignores it (prevents infinite loops)
3. **Validates file format** — only processes `.pdf`, `.png`, `.jpg`, `.jpeg`, `.tiff`
4. **Calls Textract** — `analyze_expense` API with S3 object reference
5. **Parses response** — extracts `invoice_id`, `due_date`, `receipt_date`, `invoice_number`, `total`, `line_items`
6. **Calls Bedrock** — with a prompt asking the LLM to find inconsistencies and unusual charges
7. **Handles throttling** — exponential backoff retry logic + rate limiter (`max_requests_per_minute`)
8. **Writes to DynamoDB** — `PutItem` with all extracted fields + `llm_analysis`
9. **Saves text backup to S3** — 4 fallback strategies if the configured bucket isn't found

---

## 9. What anomalies can the AI detect?

From real testing, the Bedrock LLM flagged:

| Anomaly | What it means |
|---|---|
| Non-standard date format `"23 Jan - 2025"` | Suggests manually typed/fake invoice |
| Informal invoice number `"IN-15"` | Real invoices use formats like `INV-0015` |
| Inconsistent units `"1 NOS"`, `"1 KGS"` vs `"1 KG"` | Not generated by proper billing software |
| Subtotal doesn't match line items | Real red flag — math error or doctored invoice |
| Mixed IGST rates (0%, 3%, 5%, 12%) on same invoice | Unusual, needs verification |
| Tax rate in product name (`"Walnuts 5% Tax Item"`) | Non-standard, likely manual entry |
| Unusual prices flagged against expectations | Cross-checks pricing against general knowledge |

---

## 10. How did you handle the infinite loop problem?

When Lambda saves the `.txt` file back to S3, that PUT operation would re-trigger Lambda again — causing an infinite loop.

**Solution:** At the start of the Lambda function, I check if the uploaded file path starts with `processed-text/`. If yes, the function **immediately returns** without processing. This ensures Lambda only processes original invoice uploads, not its own output files.

---

## 11. How did you handle Bedrock throttling?

Amazon Bedrock has rate limits on API calls. To handle this I implemented:

1. **Rate Limiter** — restricts calls to `max_requests_per_minute` (configurable)
2. **Exponential Backoff** — on `ThrottlingException`, waits with increasing delay before retrying (up to 4 retries)
3. **CloudWatch logging** — logs every retry attempt so you can monitor throttling in production

---

## 12. What is the DynamoDB schema?

```json
{
  "invoice_id": "INV-12345",        // Partition key (Primary key)
  "invoice_number": "INV-12345",
  "due_date": "2024-03-15",
  "receipt_date": "2024-02-15",
  "total": "$1,234.56",
  "line_items": [
    { "item": "Product A", "price": "$100.00" },
    { "item": "Product B", "price": "$200.00" }
  ],
  "llm_analysis": "AI anomaly detection findings..."
}
```

---

## 13. What IAM permissions does Lambda need?

```
s3:GetObject        — read invoice from source bucket
s3:PutObject        — save processed text to output bucket
s3:HeadBucket       — check if output bucket exists
textract:AnalyzeExpense  — call Textract OCR
bedrock:InvokeModel      — call Bedrock LLM
dynamodb:PutItem         — write to invoices table
logs:CreateLogGroup      — CloudWatch logging
logs:CreateLogStream
logs:PutLogEvents
```

I followed the **principle of least privilege** — Lambda only has exactly the permissions it needs, nothing more.

---

## 14. What challenges did you face?

| Challenge | How I solved it |
|---|---|
| Bedrock throttling on burst uploads | Rate limiter + exponential backoff retry logic |
| Lambda re-triggering on its own output | Skip files in `processed-text/` folder |
| Different invoices having different S3 output buckets | 4 fallback strategies for finding/using output bucket |
| Textract returning inconsistent field names across invoice formats | Defensive parsing with `.get()` and default values |
| Invoice images with poor quality | Tested with multiple formats (PNG, JPG, PDF) — Textract handles them natively |

---

## 15. How would you improve this project in production?

1. **Add SQS queue** between S3 and Lambda — decouples the trigger, handles burst uploads gracefully, prevents Lambda concurrency limits from being hit
2. **Dead Letter Queue (DLQ)** — failed invoice processing goes to DLQ for manual review instead of silent failure
3. **SNS notifications** — send email/Slack alert when a high-risk anomaly is detected
4. **Step Functions** — orchestrate the pipeline for better visibility and error handling at each step
5. **API Gateway** — add a REST API to query invoice audit results from DynamoDB
6. **CI/CD pipeline** — automate Lambda deployments using CodePipeline or GitHub Actions
7. **Encryption** — enable S3 bucket encryption and DynamoDB encryption at rest for financial data compliance

---

## 16. What is the cost model for this project?

This project is nearly **free at low volume** because everything is serverless:

| Service | Cost model |
|---|---|
| Lambda | Pay per invocation + execution time (free tier: 1M requests/month) |
| S3 | Pay per GB stored + requests (very cheap) |
| Textract | Pay per page analyzed (~$0.015/page for AnalyzeExpense) |
| Bedrock Nova Micro | Pay per token (very low cost for short invoice texts) |
| DynamoDB | Pay per read/write unit (free tier: 25 GB storage) |

For a small business processing ~1000 invoices/month, the total cost would be **under $5/month**.

---

## 17. How is this different from just using a Python script?

| Aspect | Python Script | This Pipeline |
|---|---|---|
| Trigger | Manual run | Automatic on every S3 upload |
| Scale | Single machine | Scales to thousands of invoices simultaneously |
| Availability | Only when machine is on | 24/7, always on |
| Cost | Fixed server cost | Pay only when invoices are processed |
| Maintenance | OS, packages, server updates | Zero infrastructure maintenance |
| Failures | Script crash = lost data | Lambda retries automatically |

---

## Quick Summary for Interview Opening

> "This project is a fully serverless AWS pipeline. When an invoice image is uploaded to S3, it automatically triggers a Lambda function. Lambda calls Amazon Textract to perform OCR and extract structured fields like invoice number, dates, totals, and line items. That data is then sent to Amazon Bedrock's Nova Micro LLM, which acts as an AI auditor — checking for math errors, unusual charges, non-standard formats, and potential fraud. The final structured data along with the AI analysis is stored in DynamoDB. The whole thing runs without any servers, scales automatically, and costs almost nothing at low volume. The real business value is automated invoice fraud and error detection before payments are made."
