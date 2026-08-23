# Serverless Invoice Processing & Anomaly Detection Pipeline

A fully serverless AWS pipeline that automatically ingests invoice images, extracts structured data via OCR, runs AI-powered anomaly detection, and stores everything in a NoSQL database — with zero manual intervention after setup.

---

## Architecture Overview

```
Invoice Image (PNG/JPG/PDF)
        |
        v
[S3 Source Bucket]  ──── S3 PUT Event Trigger ────>  [AWS Lambda]
                                                           |
                              ┌────────────────────────────┼────────────────────────────┐
                              v                            v                            v
                    [Amazon Textract]             [Amazon Bedrock]             [Amazon DynamoDB]
                    AnalyzeExpense API            Nova Micro Model             invoices table
                    (OCR + Structured              (AI Analysis for            (Persistent NoSQL
                     Field Extraction)             Anomaly Detection)           Storage)
                              |
                              v
                    [S3 Output Bucket]
                    processed-text/ folder
                    (Extracted .txt backup)
```

### Key AWS Services Used
| Service | Role |
|---|---|
| **S3** | Invoice upload trigger + processed text storage |
| **AWS Lambda** | Serverless orchestrator (`lambda_function.py`) |
| **Amazon Textract** | OCR via `AnalyzeExpense` API — extracts invoice fields and line items |
| **Amazon Bedrock** | AI anomaly detection using `amazon.nova-micro-v1:0` model |
| **DynamoDB** | NoSQL storage for structured invoice data + LLM analysis |
| **CloudWatch** | Logging and monitoring |
| **IAM** | Role-based permissions for Lambda |

---

## Lambda Function — What It Does (`lambda_function.py`)

The Lambda function is the brain of the pipeline. Here is what happens step by step when a file is uploaded:

1. **Triggered by S3 PUT event** — extracts bucket name and file key from the event.
2. **Skips processed files** — ignores anything under `processed-text/` to prevent re-trigger loops.
3. **Validates file format** — only allows `.pdf`, `.png`, `.jpg`, `.jpeg`, `.tiff`, `.tif`.
4. **Calls Textract `analyze_expense`** — sends the S3 object reference to Textract for OCR.
5. **Parses Textract response** — extracts `invoice_id`, `due_date`, `receipt_date`, `invoice_number`, `total`, and `line_items`.
6. **Calls Amazon Bedrock** — sends the raw text lines to the Nova Micro model asking it to detect inconsistencies and unusual charges. Includes exponential backoff retry logic with a rate limiter to handle throttling.
7. **Writes to DynamoDB** — stores the full structured record in the `invoices` table.
8. **Saves extracted text to S3** — tries 4 fallback strategies to write a `.txt` backup file.

### DynamoDB Record Schema
```json
{
  "invoice_id": "INV-12345",
  "invoice_number": "INV-12345",
  "due_date": "2024-03-15",
  "receipt_date": "2024-02-15",
  "total": "$1,234.56",
  "line_items": [
    { "item": "Product A", "price": "$100.00" },
    { "item": "Product B", "price": "$200.00" }
  ],
  "llm_analysis": "AI-generated anomaly detection text..."
}
```

---

## Step-by-Step Setup Guide

### Step 1 — Create the DynamoDB Table

1. Open the **DynamoDB Console** in AWS.
2. Click **Create table**.
3. Set **Table name** to `invoices`.
4. Set **Partition key** to `invoice_id` (type: String).
5. Leave all other settings as default.
6. Click **Create table** and wait for it to become Active.

---

### Step 2 — Create the S3 Buckets

You need **two S3 buckets**:

**Bucket 1 — Invoice Source Bucket** (where you upload invoices)
- Name suggestion: `invoice-source-<your-suffix>` (e.g., `invoice-source-abc123`)
- This is the bucket that will trigger Lambda on upload.

**Bucket 2 — Textract Output Bucket** (where processed text is saved)
- Name suggestion: `textract-ml-ai-<your-suffix>` (match the suffix from Bucket 1)  (e.g., `textract-ml-abc123`)
- This is where `.txt` backups of extracted text land.

> Both buckets should be in the same AWS region.

---

### Step 3 — Create the Lambda Function

1. Open the **Lambda Console**.
2. Click **Create function** → **Author from scratch**.
3. Set function name: `invoice_processing`.
4. Set runtime: **Python 3.12** (or latest Python 3.x).
5. Click **Create function**.
6. In the **Code** tab, **replace all default code** entirely with the contents of `lambda_function.py`.
7. Click **Deploy**.

---

### Step 4 — Configure Lambda Environment Variables

1. In your Lambda function, go to **Configuration** → **Environment variables**.
2. Click **Edit** → **Add environment variable**.
3. Add the following:

| Key | Value |
|---|---|
| `TEXTRACT_OUTPUT_BUCKET` | `textract-ml-ai-<your-suffix>` |

4. Click **Save**.

> `AWS_REGION` is automatically injected by Lambda — no need to add it manually.

---

### Step 5 — Set Lambda IAM Permissions

Your Lambda's execution role needs the following permissions. Attach them via **IAM → Roles → your Lambda role → Add permissions → Create inline policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:HeadBucket"],
      "Resource": ["arn:aws:s3:::*"]
    },
    {
      "Effect": "Allow",
      "Action": ["textract:AnalyzeExpense"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:*:*:table/invoices"
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "*"
    }
  ]
}
```

---

### Step 6 — Enable Amazon Bedrock Model Access

1. Open the **Amazon Bedrock Console**.
2. Go to **Model access** (left sidebar).
3. Find **Amazon Nova Micro** (`amazon.nova-micro-v1:0`).
4. Click **Manage model access** and **enable** it.
5. Wait for the status to change to **Access granted**.

> Without this step, Bedrock calls will fail with an access error.

---

### Step 7 — Configure S3 Event Notification (Trigger)

1. Open the **S3 Console** and select your **source bucket** (Bucket 1).
2. Go to the **Properties** tab.
3. Scroll down to **Event notifications** and click **Create event notification**.
4. Fill in the fields:
   - **Event name**: `invoice_processing`
   - **Event types**: Check only **PUT** (s3:ObjectCreated:Put)
5. Under **Destination**, select **Lambda function**.
6. From the dropdown, choose the `invoice_processing` Lambda function.
7. Click **Save changes**.

> Lambda will now be triggered automatically every time a file is uploaded (PUT) to this bucket.

---

### Step 8 — Test the Pipeline

1. Upload one of the sample invoices from the `invoices/` folder to your source S3 bucket:
   - `invoice_1.png`
   - `invoice_2.png`
   - `invoice_3.png`
2. Upload them **one by one** to observe each event being triggered separately.

**To monitor in real time:**
- Open **CloudWatch → Log groups → /aws/lambda/invoice_processing**
- Watch for logs like:
  ```
  Processing invoice: invoice_1.png from bucket: invoice-source-abc123
  Successfully inserted invoice INV-XXX into DynamoDB
  Successfully processed invoice: invoice_1.png
  ```

---

### Step 9 — Verify Results in DynamoDB

1. Open the **DynamoDB Console**.
2. Select the `invoices` table.
3. Click **Explore table items** (top right).
4. You should see a new record for each uploaded invoice.
5. Expand each record to inspect:
   - `line_items` — structured list of products/services and prices.
   - `llm_analysis` — AI-generated anomaly detection summary from Bedrock.

---

### Step 10 — Check Processed Text in S3 Output Bucket

1. Open the **S3 Console** and navigate to your **output bucket** (`textract-ml-ai-<suffix>`).
2. You should see `.txt` files containing the raw text extracted from each invoice.
3. If the output bucket wasn't found, Lambda falls back to saving under `processed-text/` in the source bucket.

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| Lambda not triggered | S3 event notification misconfigured | Re-check Step 7, ensure PUT is selected |
| Textract error | Unsupported file format | Only upload PNG, JPG, PDF, TIFF |
| Bedrock `AccessDeniedException` | Model access not enabled | Complete Step 6 |
| Bedrock `ThrottlingException` | Too many requests | Reduce `max_requests_per_minute` in the rate limiter or request quota increase |
| DynamoDB write fails | Table doesn't exist or wrong name | Confirm table is named exactly `invoices` with partition key `invoice_id` |
| S3 write fails | Missing IAM permissions or bucket doesn't exist | Verify Bucket 2 exists and IAM role has `s3:PutObject` |
| Re-trigger loop | Lambda processing its own output | Already handled — files in `processed-text/` are skipped automatically |

---

## Project File Reference

```
Trigger_OCR_Function_FM_NoSQL/
├── lambda_function.py          # Main Lambda function — deploy this to AWS Lambda
├── invoices/
│   ├── invoice_1.png           # Sample invoice for testing
│   ├── invoice_2.png           # Sample invoice for testing
│   └── invoice_3.png           # Sample invoice for testing
├── ReadersAreTheLeaders.txt    # Quick-start notes and key setup reminders
├── README.md                   # Detailed project documentation
└── steps_to_do.md              # This file — complete step-by-step guide
```

---

## Quick Checklist

- [ ] DynamoDB table `invoices` created with partition key `invoice_id`
- [ ] S3 source bucket created
- [ ] S3 output bucket `textract-ml-ai-<suffix>` created
- [ ] Lambda function `invoice_processing` created and code deployed
- [ ] `TEXTRACT_OUTPUT_BUCKET` environment variable set on Lambda
- [ ] IAM role permissions granted (S3, Textract, Bedrock, DynamoDB, CloudWatch)
- [ ] Amazon Bedrock Nova Micro model access enabled
- [ ] S3 PUT event notification configured to trigger Lambda
- [ ] Test invoices uploaded one by one
- [ ] DynamoDB records verified with `line_items` and `llm_analysis`
- [ ] S3 output bucket checked for `.txt` files
