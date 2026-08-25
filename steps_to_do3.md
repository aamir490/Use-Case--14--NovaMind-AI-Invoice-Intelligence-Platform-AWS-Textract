# AI-Powered Invoice Intelligence Platform
## Complete Implementation Guide — From POC to Production Portfolio Project

> Think: Senior AWS Solutions Architect + AI/ML Engineer + MLOps Engineer + Full-Stack Engineer
> Goal: Enterprise-grade AI product suitable as your main interview/portfolio project

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Strengths and Weaknesses](#2-strengths-and-weaknesses)
3. [Target Architecture](#3-target-architecture)
4. [AWS Services and Responsibilities](#4-aws-services-and-responsibilities)
5. [Project Folder Structure](#5-project-folder-structure)
6. [Technology Stack Decisions](#6-technology-stack-decisions)
7. [Database Design](#7-database-design)
8. [API Design](#8-api-design)
9. [Authentication and Authorization Design](#9-authentication-and-authorization-design)
10. [AI/ML Improvements](#10-aiml-improvements)
11. [Implementation Roadmap — Phase by Phase](#11-implementation-roadmap--phase-by-phase)
12. [Security and Compliance Checklist](#12-security-and-compliance-checklist)
13. [Monitoring and Observability](#13-monitoring-and-observability)
14. [CI/CD and MLOps](#14-cicd-and-mlops)
15. [Cost Optimization](#15-cost-optimization)
16. [Interview Talking Points](#16-interview-talking-points)

---

## 1. Current State Analysis

### What Exists Today

**Single file:** `lambda_function.py` (the entire application)

**Current data flow (step by step):**

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT ARCHITECTURE                          │
└─────────────────────────────────────────────────────────────────┘

User (manual)
    │
    │  uploads invoice image manually via AWS Console or CLI
    ▼
[S3 Source Bucket]  ────── S3 PUT event ──────►  [AWS Lambda]
                                                       │
                                     ┌─────────────────┼─────────────────┐
                                     ▼                 ▼                 ▼
                             [Textract]          [Bedrock]         [DynamoDB]
                             analyze_expense     Nova Micro        invoices table
                             OCR extraction      anomaly prompt    PutItem
                                     │
                                     ▼
                             [S3 Output Bucket]
                             processed-text/*.txt
```

**What the Lambda function does:**
1. Receives S3 PUT event
2. Skips files under `processed-text/` (loop prevention)
3. Validates file extension (.pdf, .png, .jpg, .jpeg, .tiff)
4. Calls `textract.analyze_expense()` — extracts invoice_id, due_date, receipt_date, invoice_number, total, line_items
5. Calls Bedrock `amazon.nova-micro-v1:0` with a prompt: "check for inconsistencies and unusual charges"
6. Writes the record to DynamoDB table `invoices`
7. Saves raw text backup to S3 (4 fallback bucket strategies)

**Current DynamoDB schema:**
```json
{
  "invoice_id": "INV-12345",
  "invoice_number": "INV-12345",
  "due_date": "2024-03-15",
  "receipt_date": "2024-02-15",
  "total": "$1,234.56",
  "line_items": [{"item": "...", "price": "..."}],
  "llm_analysis": "free-text AI analysis string"
}
```

**Existing files in the project:**
| File | Purpose | Keep? |
|---|---|---|
| `lambda_function.py` | Core processing logic | YES — refactor and extend |
| `invoices/invoice_*.png/jpg` | Test data | YES |
| `README.md` | Setup docs | YES — update |
| `steps_to_do.md` | Original setup guide | YES — reference |
| `interview.md` | Interview prep notes | YES — superseded by this file |
| `what your project is this.txt` | Notes on what the project does | Archive |
| `ReadersAreTheLeaders.txt` / `.rtf` | Quick-start cheat sheet | Archive |
| `dynamodb_output.png` | Screenshot of DynamoDB result | Archive |
| `Serverless Invoice Processing...jpeg` | Architecture diagram | Archive |

---

## 2. Strengths and Weaknesses

### Strengths (what to keep and build on)
- The core pipeline works end-to-end and is already serverless
- Textract `AnalyzeExpense` is exactly the right tool — keep it
- Bedrock integration exists and produces real value
- Rate limiting and retry logic in the Lambda function is solid
- The infinite-loop prevention (`processed-text/` skip) is correct
- 4 fallback strategies for S3 output is good defensive coding
- DynamoDB is the right database choice for this use case

### Weaknesses (what to fix)
- No frontend — no way to use this without AWS Console access
- No API layer — data is locked inside DynamoDB, not queryable externally
- No authentication — anyone with AWS access can read/write all data
- AI output is unstructured free text (`llm_analysis` is one long string) — hard to query, filter, or display
- No risk scoring — the AI says "this looks suspicious" but gives no numeric score
- No processing status tracking — no way to know if an invoice is being processed
- No error handling at the user level — failures are invisible unless you open CloudWatch
- No search, filter, or pagination on invoices
- No file validation beyond extension check (content type not verified)
- Lambda function is monolithic — one big function doing everything
- No infrastructure as code — everything set up manually via console
- No CI/CD — deployment is manual copy-paste
- No tests
- Hard-coded table name `invoices` and model ID in code
- No dead letter queue — failed invoices are silently lost
- No multi-tenancy — all invoices in one table, no user separation

---

## 3. Target Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     TARGET ARCHITECTURE                                          │
│                AI-Powered Invoice Intelligence Platform                          │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────┐
                              │   User / Browser     │
                              └──────────┬──────────┘
                                         │ HTTPS
                              ┌──────────▼──────────┐
                              │    CloudFront CDN    │  ← serves React SPA
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                     ▼
           [S3 Static Website]   [API Gateway]         [Cognito]
           React frontend        REST API / JWT         User auth
                                         │
                    ┌────────────────────┼─────────────────────────────┐
                    ▼                    ▼                              ▼
           [POST /invoices]      [GET /invoices]              [GET /analytics]
           Upload + trigger      List, filter, search          Charts data
                    │
                    ▼
           [S3 Invoice Bucket]  ← pre-signed URL upload
                    │
                    │  S3 PUT Event
                    ▼
           [SQS Queue]           ← decouples upload from processing
                    │
                    │  SQS trigger
                    ▼
           [Step Functions]      ← orchestrates the processing pipeline
                    │
          ┌─────────┼──────────┬──────────────────┐
          ▼         ▼          ▼                   ▼
    [Lambda 1]  [Lambda 2]  [Lambda 3]       [Lambda 4]
    OCR         AI Analysis  Risk Scoring    Store Results
    (Textract)  (Bedrock)    (Rule Engine)   (DynamoDB)
          │         │          │
          └─────────┴──────────┘
                    │
                    ▼
           [DynamoDB]
           invoices table
           users table
           processing_jobs table
                    │
                    ▼
           [EventBridge]        ← publishes events on anomaly detection
                    │
                    ▼
           [SNS]                ← email/notification on high-risk invoice
                    │
                    ▼
           [CloudWatch + X-Ray] ← observability
```

### Data Flow (new, step by step)

1. User logs in via the React frontend → authenticated through **Cognito**
2. User selects an invoice file on the dashboard
3. Frontend requests a **pre-signed S3 URL** from API Gateway → Lambda returns URL
4. Frontend uploads the file **directly to S3** via the pre-signed URL (no API bandwidth waste)
5. S3 PUT event sends a message to **SQS** (not Lambda directly — decoupled)
6. SQS triggers a **Step Functions** state machine execution
7. Step Functions runs the processing stages in sequence:
   - **Step 1 — OCR Lambda:** calls Textract `analyze_expense`, extracts structured fields
   - **Step 2 — AI Analysis Lambda:** calls Bedrock with a structured prompt, returns JSON anomaly report
   - **Step 3 — Risk Scoring Lambda:** applies deterministic rules on top of AI output, produces a numeric risk score (0–100)
   - **Step 4 — Store Results Lambda:** writes the complete record to DynamoDB, updates processing status
8. On completion, **EventBridge** fires an event
9. If risk score > 70, **SNS** sends an email notification
10. The React dashboard polls the API for status updates and displays results in real time
11. CloudWatch and X-Ray capture every step for observability

---

## 4. AWS Services and Responsibilities

Every service below earns its place — no padding.

| Service | Why it's here | What it replaces / adds |
|---|---|---|
| **S3** | Invoice storage + static frontend hosting | Already exists — extend with lifecycle policies and versioning |
| **CloudFront** | CDN for React frontend + API caching | New — serves frontend globally with HTTPS |
| **Cognito** | Authentication and authorization | New — replaces "anyone with AWS access" |
| **API Gateway** | REST API layer with JWT validation | New — exposes data to the frontend |
| **SQS** | Decouples S3 upload from processing pipeline | New — replaces direct Lambda trigger, adds retry and buffering |
| **Step Functions** | Orchestrates multi-step processing pipeline | New — replaces the monolithic Lambda function |
| **Lambda (x4)** | Each step in the pipeline as a separate function | Refactored from single Lambda to 4 specialized functions |
| **Textract** | OCR extraction of invoice fields | Already exists — keep as-is |
| **Bedrock (Nova)** | AI anomaly detection and explanation | Already exists — upgrade prompt to return structured JSON |
| **DynamoDB** | Primary data store | Already exists — add GSIs for querying |
| **EventBridge** | Event bus for post-processing notifications | New — decouples notification logic from processing |
| **SNS** | Email alerts for high-risk invoices | New — adds proactive alerting |
| **CloudWatch** | Logs, metrics, dashboards, alarms | Partially exists — formalize with dashboards and alarms |
| **X-Ray** | Distributed tracing across Lambda functions | New — critical for debugging Step Functions chains |
| **IAM** | Fine-grained permissions per Lambda function | Already exists — tighten to least privilege per function |
| **CloudFormation / CDK** | Infrastructure as Code | New — replaces all manual console setup |

**Services NOT included (and why):**
- **RDS** — DynamoDB is sufficient; RDS adds cost and maintenance overhead without benefit for this use case
- **SageMaker** — Bedrock is the right tool here; SageMaker is justified only if training a custom model
- **Kinesis** — SQS is sufficient for the invoice volume; Kinesis is for high-throughput streaming
- **ElasticSearch** — DynamoDB GSIs with API-level filtering is sufficient for MVP; add OpenSearch only if full-text search across invoice content is needed later
- **ECS/EKS** — Lambda handles this workload perfectly; containers add unnecessary complexity

---

## 5. Project Folder Structure

```
invoice-intelligence-platform/
│
├── infrastructure/                    ← All Infrastructure as Code (AWS CDK)
│   ├── bin/
│   │   └── app.ts                     ← CDK entry point
│   ├── lib/
│   │   ├── storage-stack.ts           ← S3 buckets, DynamoDB tables
│   │   ├── auth-stack.ts              ← Cognito user pool and clients
│   │   ├── api-stack.ts               ← API Gateway routes and Lambdas
│   │   ├── processing-stack.ts        ← SQS, Step Functions, Lambda functions
│   │   ├── notification-stack.ts      ← EventBridge, SNS
│   │   └── frontend-stack.ts          ← CloudFront, S3 static hosting
│   ├── package.json
│   └── cdk.json
│
├── backend/
│   ├── lambdas/
│   │   ├── ocr/
│   │   │   ├── handler.py             ← Textract integration (from lambda_function.py)
│   │   │   ├── parser.py              ← Textract response parsing logic
│   │   │   └── requirements.txt
│   │   ├── ai-analysis/
│   │   │   ├── handler.py             ← Bedrock integration
│   │   │   ├── prompt_builder.py      ← Structured prompt construction
│   │   │   └── requirements.txt
│   │   ├── risk-scoring/
│   │   │   ├── handler.py             ← Deterministic risk scoring rules
│   │   │   ├── rules.py               ← Business rules for anomaly scoring
│   │   │   └── requirements.txt
│   │   ├── store-results/
│   │   │   ├── handler.py             ← DynamoDB write operations
│   │   │   └── requirements.txt
│   │   ├── api/
│   │   │   ├── invoices.py            ← GET /invoices, GET /invoices/{id}
│   │   │   ├── upload.py              ← POST /invoices/upload (pre-signed URL)
│   │   │   ├── analytics.py           ← GET /analytics
│   │   │   └── requirements.txt
│   │   └── shared/
│   │       ├── models.py              ← Pydantic data models
│   │       ├── db.py                  ← DynamoDB client and helpers
│   │       └── exceptions.py          ← Custom exception classes
│   │
│   ├── step-functions/
│   │   └── processing-pipeline.json   ← Step Functions state machine definition
│   │
│   └── tests/
│       ├── unit/
│       │   ├── test_ocr.py
│       │   ├── test_ai_analysis.py
│       │   ├── test_risk_scoring.py
│       │   └── test_api.py
│       └── integration/
│           └── test_pipeline.py
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── Header.tsx
│   │   │   │   └── Layout.tsx
│   │   │   ├── invoices/
│   │   │   │   ├── InvoiceUpload.tsx   ← Drag-and-drop upload zone
│   │   │   │   ├── InvoiceList.tsx     ← Table with search and filters
│   │   │   │   ├── InvoiceDetail.tsx   ← Full invoice view with AI report
│   │   │   │   └── RiskBadge.tsx       ← Color-coded risk level badge
│   │   │   ├── analytics/
│   │   │   │   ├── Dashboard.tsx       ← Main analytics dashboard
│   │   │   │   ├── RiskChart.tsx       ← Risk score distribution chart
│   │   │   │   ├── VolumeChart.tsx     ← Invoices over time
│   │   │   │   └── AnomalyList.tsx     ← Recent high-risk invoices
│   │   │   └── auth/
│   │   │       ├── LoginPage.tsx
│   │   │       └── AuthProvider.tsx
│   │   ├── hooks/
│   │   │   ├── useInvoices.ts          ← Invoice list + pagination
│   │   │   ├── useInvoiceDetail.ts     ← Single invoice data
│   │   │   └── useAnalytics.ts         ← Analytics data
│   │   ├── services/
│   │   │   ├── api.ts                  ← API client (axios)
│   │   │   ├── auth.ts                 ← Cognito auth helpers
│   │   │   └── upload.ts               ← S3 pre-signed URL upload
│   │   ├── store/
│   │   │   └── index.ts                ← Zustand state management
│   │   ├── pages/
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── InvoicesPage.tsx
│   │   │   ├── InvoiceDetailPage.tsx
│   │   │   └── AnalyticsPage.tsx
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── invoices/                          ← Existing test data (keep)
│   ├── invoice_1.png
│   ├── invoice_2.png
│   ├── invoice_3.png
│   ├── invoice_5.jpg
│   └── invoice_6.png
│
├── .github/
│   └── workflows/
│       ├── backend.yml                ← CI/CD for Lambda functions
│       └── frontend.yml               ← CI/CD for React frontend
│
├── .env.example                       ← Template for environment variables
├── README.md                          ← Updated project README
└── steps_to_do3.md                    ← This file
```

---

## 6. Technology Stack Decisions

### Backend
| Layer | Choice | Reason |
|---|---|---|
| Language | Python 3.12 | Already in use, Textract/Bedrock SDKs are best in Python |
| Data validation | Pydantic v2 | Type safety, JSON serialization, good for Lambda |
| HTTP client | boto3 (AWS SDK) | Required for all AWS services |
| IaC | AWS CDK v2 (TypeScript) | More powerful than CloudFormation, better IDE support than Terraform for AWS-specific resources |

### Frontend
| Layer | Choice | Reason |
|---|---|---|
| Framework | React 18 + TypeScript | Industry standard, strong typing |
| Build tool | Vite | Fast, modern, simple config |
| Styling | Tailwind CSS | Utility-first, consistent, fast to build with |
| Charts | Recharts | React-native charts, good API, lightweight |
| State | Zustand | Simple, small footprint, no Redux boilerplate |
| API client | axios + React Query | Caching, background refresh, loading states built in |
| Auth | AWS Amplify Auth (Cognito wrapper) | Official AWS library, handles token refresh |
| Upload | Direct S3 via pre-signed URL | No Lambda bandwidth cost |
| Routing | React Router v6 | Standard |
| UI components | shadcn/ui | Modern, accessible, no framework lock-in |

### Why NOT Next.js here?
This is a Single Page Application deployed on S3/CloudFront. Next.js adds complexity (SSR, server routes) that would require deploying to Lambda@Edge or a Node.js server. A Vite React SPA is simpler, cheaper, and correct for this use case.

---

## 7. Database Design

### DynamoDB Table: `invoices`

**Primary Key:** `tenant_id` (Partition Key) + `invoice_id` (Sort Key)

This enables multi-tenancy — each Cognito user has their own namespace.

**Full item schema:**
```json
{
  "tenant_id": "user-uuid-from-cognito",
  "invoice_id": "inv_20240315_abc123",
  "invoice_number": "INV-12345",
  "vendor_name": "ACME Corp",
  "due_date": "2024-03-15",
  "receipt_date": "2024-02-15",
  "total_amount": 1234.56,
  "currency": "USD",
  "status": "completed",
  "risk_score": 75,
  "risk_level": "HIGH",
  "line_items": [
    {"item": "Product A", "price": 100.00, "quantity": 1}
  ],
  "anomalies": [
    {
      "type": "MATH_ERROR",
      "severity": "HIGH",
      "description": "Line items do not sum to stated total",
      "field": "total"
    }
  ],
  "ai_explanation": "Structured explanation from Bedrock",
  "s3_key": "invoices/tenant-id/inv_20240315_abc123.png",
  "processed_text_s3_key": "processed-text/inv_20240315_abc123.txt",
  "created_at": "2024-02-15T10:30:00Z",
  "processed_at": "2024-02-15T10:30:45Z",
  "processing_time_ms": 4500
}
```

**Global Secondary Indexes (GSIs):**

| GSI Name | Partition Key | Sort Key | Use Case |
|---|---|---|---|
| `status-created-index` | `status` | `created_at` | Filter by processing status |
| `risk-level-index` | `risk_level` | `created_at` | Filter high-risk invoices |
| `vendor-index` | `vendor_name` | `created_at` | Group invoices by vendor |

**DynamoDB Table: `processing_jobs`**

Tracks the status of each Step Functions execution.

```json
{
  "job_id": "sfn-execution-arn",
  "invoice_id": "inv_20240315_abc123",
  "tenant_id": "user-uuid",
  "status": "PROCESSING | COMPLETED | FAILED",
  "stage": "OCR | AI_ANALYSIS | RISK_SCORING | STORING",
  "error_message": null,
  "started_at": "2024-02-15T10:30:00Z",
  "updated_at": "2024-02-15T10:30:45Z"
}
```

**Why no RDS?**
Invoice schema varies by vendor. Forcing it into relational tables means either nullable columns everywhere or complex EAV (Entity-Attribute-Value) patterns. DynamoDB handles variable schemas naturally and is serverless — zero operational overhead.

---

## 8. API Design

### Base URL
`https://api.yourdomain.com/v1`

All endpoints require `Authorization: Bearer {cognito-jwt-token}` header.

### Endpoints

**Invoice Operations**
```
POST   /invoices/upload-url     ← Request pre-signed S3 URL for upload
GET    /invoices                ← List invoices (paginated, filterable)
GET    /invoices/{id}           ← Get single invoice with full AI report
GET    /invoices/{id}/status    ← Get processing job status
DELETE /invoices/{id}           ← Delete invoice and S3 files
```

**Analytics**
```
GET    /analytics/summary       ← Totals: count, avg risk, high-risk count
GET    /analytics/risk-trend    ← Risk scores over time (for line chart)
GET    /analytics/vendor-stats  ← Invoices and risk by vendor (for bar chart)
GET    /analytics/anomaly-types ← Breakdown of anomaly types (for pie chart)
```

**Query Parameters for GET /invoices:**
```
?status=completed&risk_level=HIGH&vendor=ACME&from=2024-01-01&to=2024-03-31
&page_size=20&last_key={base64-encoded-dynamo-key}
```

### Example: POST /invoices/upload-url

**Request:**
```json
{
  "filename": "invoice_march.pdf",
  "content_type": "application/pdf"
}
```

**Response:**
```json
{
  "invoice_id": "inv_20240315_abc123",
  "upload_url": "https://s3.amazonaws.com/...?X-Amz-Signature=...",
  "expires_in": 300
}
```

The frontend then uploads the file directly to that pre-signed URL with a PUT request. No API bandwidth consumed.

### Example: GET /invoices/{id}

**Response:**
```json
{
  "invoice_id": "inv_20240315_abc123",
  "invoice_number": "INV-12345",
  "vendor_name": "ACME Corp",
  "total_amount": 1234.56,
  "status": "completed",
  "risk_score": 75,
  "risk_level": "HIGH",
  "line_items": [...],
  "anomalies": [
    {
      "type": "MATH_ERROR",
      "severity": "HIGH",
      "description": "Line items total $1,100 but stated total is $1,234.56",
      "field": "total"
    }
  ],
  "ai_explanation": "The invoice contains a discrepancy between the sum of line items...",
  "created_at": "2024-02-15T10:30:00Z",
  "processing_time_ms": 4500
}
```

---

## 9. Authentication and Authorization Design

### Cognito Setup

**User Pool:** `invoice-platform-users`
- Email-based sign-up and sign-in
- Email verification required
- Password policy: min 8 chars, uppercase, lowercase, number, special char

**User Pool Client:** `invoice-platform-web-client`
- Auth flows: `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`
- Token validity: Access token 1 hour, Refresh token 30 days

**Identity Pool (optional for Phase 2):**
Only needed if you want direct AWS service access from the browser. For now, all AWS access goes through the API Gateway + Lambda — no need for an identity pool in Phase 1.

### JWT Validation in API Gateway

API Gateway uses a **Cognito Authorizer** — it validates the JWT automatically. Lambda functions receive the validated user identity in the event context:

```python
# Inside any API Lambda function
user_id = event['requestContext']['authorizer']['claims']['sub']
# This is the tenant_id used in DynamoDB
```

### Authorization Rules

- Each user can only see their own invoices (enforced by `tenant_id = cognito_sub` in every DynamoDB query)
- No admin role in Phase 1 — add it in Phase 3 if needed
- Pre-signed S3 URLs are scoped to `invoices/{tenant_id}/` prefix — users cannot read each other's files

---

## 10. AI/ML Improvements

### Current Problem

The current Bedrock prompt returns a free-text paragraph. You can't:
- Filter invoices by anomaly type
- Sort by severity
- Show a numeric risk score
- Build charts on top of the analysis
- Compare invoices programmatically

### Fix 1: Structured JSON Output from Bedrock

Change the prompt to require JSON output:

```python
prompt = """
You are an expert invoice auditor. Analyze the invoice data below and return ONLY a JSON object.

Invoice data:
{invoice_text}

Return exactly this JSON structure:
{{
  "anomalies": [
    {{
      "type": "MATH_ERROR | DATE_INCONSISTENCY | UNUSUAL_PRICE | NON_STANDARD_FORMAT | TAX_IRREGULARITY | DUPLICATE_ITEM | MISSING_FIELD",
      "severity": "LOW | MEDIUM | HIGH",
      "description": "specific finding in plain English",
      "field": "the field or line item affected"
    }}
  ],
  "summary": "2-3 sentence summary of findings",
  "confidence": 0.0-1.0
}}

Return only valid JSON. No explanation outside the JSON.
"""
```

This enables every downstream feature: filtering, sorting, charts, badges.

### Fix 2: Deterministic Risk Scoring (Risk Scoring Lambda)

The AI score alone is not enough — add a rules engine that produces a deterministic score:

```python
def calculate_risk_score(invoice_data, ai_anomalies):
    score = 0
    
    # Deterministic rules (always applied)
    if not line_items_sum_to_total(invoice_data):
        score += 40   # Math error is a hard red flag
    
    if has_non_standard_invoice_number(invoice_data):
        score += 10
    
    if has_non_standard_date_format(invoice_data):
        score += 10
    
    if has_inconsistent_units(invoice_data):
        score += 10
    
    # AI-based additions
    for anomaly in ai_anomalies:
        if anomaly['severity'] == 'HIGH':
            score += 15
        elif anomaly['severity'] == 'MEDIUM':
            score += 7
        elif anomaly['severity'] == 'LOW':
            score += 3
    
    return min(score, 100)  # Cap at 100

def get_risk_level(score):
    if score >= 70:
        return 'HIGH'
    elif score >= 40:
        return 'MEDIUM'
    else:
        return 'LOW'
```

**Why both AI and rules?**
- AI catches nuanced issues humans define in natural language
- Rules engine catches math and format issues with 100% reliability
- Combined score is more robust than either alone

### Fix 3: Better Bedrock Model (optional Phase 3)

Upgrade from `amazon.nova-micro-v1:0` to `amazon.nova-lite-v1:0` or `anthropic.claude-3-haiku-20240307-v1:0` for better reasoning. Nova Micro is fast and cheap but limited in complex reasoning. Claude Haiku provides significantly better analysis at still-low cost.

### MLOps Considerations

In Phase 3, you can build a simple feedback loop:
- Add a "Flag as False Positive" button in the UI
- Store feedback in a `feedback` DynamoDB table
- Use feedback data to improve prompts (prompt engineering)
- This is a lightweight MLOps loop without needing SageMaker

---

## 11. Implementation Roadmap — Phase by Phase

This is your step-by-step plan. Each phase builds on the last. Do NOT skip phases.

---

### Phase 0: Project Setup and Cleanup
**Time estimate: 1–2 hours**
**Goal:** Clean repo structure before writing any new code.

**Tasks:**

**0.1 — Reorganize the repository**
- Create the folder structure defined in Section 5
- Move `lambda_function.py` to `backend/lambdas/ocr/handler.py` as a starting point
- Move `invoices/` folder — keep it as test data
- Archive `ReadersAreTheLeaders.txt`, `ReadersAreTheLeaders.rtf`, `what your project is this.txt`, `dynamodb_output.png`, `Serverless Invoice Processing...jpeg` into an `archive/` folder
- Update `.gitignore` for Python, Node.js, and CDK artifacts

**Files to create:**
- `.gitignore`
- `.env.example`
- `README.md` (update with new architecture)

**0.2 — Initialize infrastructure package**
```bash
mkdir infrastructure
cd infrastructure
npx aws-cdk init app --language typescript
```

**0.3 — Initialize frontend package**
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

**Expected result after Phase 0:**
Clean folder structure exists. CDK project initializes without errors. React app runs locally on `localhost:5173`.

**How to test:**
```bash
cd infrastructure && npx cdk synth  # Should output CloudFormation template
cd frontend && npm run dev          # Should show Vite default page
```

---

### Phase 1: Core Infrastructure with CDK
**Time estimate: 4–6 hours**
**Goal:** All AWS resources created via code, not manually.

**Why CDK instead of manual console setup:**
Everything in `steps_to_do.md` was set up by clicking through the AWS console. That approach doesn't scale, can't be versioned, can't be reproduced, and breaks in interviews when asked "how would you deploy this to a new environment?" CDK fixes all of this.

**Tasks:**

**1.1 — Storage Stack (`storage-stack.ts`)**

Create:
- S3 bucket: `invoice-uploads-{env}-{account}` — with versioning and server-side encryption
- S3 bucket: `invoice-processed-{env}-{account}` — for Textract output text
- S3 bucket: `invoice-frontend-{env}` — for React SPA
- DynamoDB table `invoices` with composite key and GSIs (as defined in Section 7)
- DynamoDB table `processing_jobs`

**Key CDK code pattern:**
```typescript
const invoicesBucket = new s3.Bucket(this, 'InvoicesBucket', {
  versioned: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  lifecycleRules: [{
    expiration: Duration.days(365),
    transitions: [{
      storageClass: s3.StorageClass.INTELLIGENT_TIERING,
      transitionAfter: Duration.days(30)
    }]
  }]
});
```

**1.2 — Auth Stack (`auth-stack.ts`)**

Create:
- Cognito User Pool with email verification
- Cognito User Pool Client (web app client)

**1.3 — Processing Stack (`processing-stack.ts`)**

Create:
- SQS queue: `invoice-processing-queue` with DLQ attached
- SQS dead-letter queue: `invoice-processing-dlq`
- S3 → SQS event notification (replaces direct S3 → Lambda trigger)
- 4 Lambda functions (OCR, AI Analysis, Risk Scoring, Store Results)
- Step Functions state machine
- SQS → Step Functions trigger Lambda

**1.4 — API Stack (`api-stack.ts`)**

Create:
- API Gateway REST API
- Cognito Authorizer on all protected routes
- Lambda functions for each API endpoint
- CORS configuration

**1.5 — Frontend Stack (`frontend-stack.ts`)**

Create:
- CloudFront distribution pointing to frontend S3 bucket
- CloudFront Origin Access Control for S3

**Expected result after Phase 1:**
Run `cdk deploy --all` and all AWS resources are created automatically. No manual console clicks needed.

**How to test:**
```bash
cd infrastructure && npx cdk deploy --all
# Check AWS console — all resources should exist
# DynamoDB tables, S3 buckets, SQS queue, Cognito user pool, API Gateway
```

---

### Phase 2: Refactored Backend Lambdas
**Time estimate: 6–8 hours**
**Goal:** Break the monolithic Lambda into 4 focused functions.

**Why split the Lambda:**
The current Lambda does OCR + AI + storage in a single function. If Bedrock is slow (4–8 seconds), the entire Lambda blocks. With Step Functions, each step runs independently, failures are isolated, and you can retry individual steps without rerunning everything.

**Tasks:**

**2.1 — OCR Lambda (`backend/lambdas/ocr/handler.py`)**

Extracted from the existing `lambda_function.py`. Responsibilities:
- Receives Step Functions input with `{invoice_id, s3_key, tenant_id}`
- Calls `textract.analyze_expense()`
- Parses response using the existing `parse_invoice_data()` logic (move to `parser.py`)
- Returns structured OCR output as JSON to Step Functions

**What changes from the original:**
- Remove DynamoDB writes (moved to store-results Lambda)
- Remove Bedrock call (moved to ai-analysis Lambda)
- Remove S3 text save (moved to store-results Lambda)
- Return data via Step Functions payload instead of DynamoDB

**2.2 — AI Analysis Lambda (`backend/lambdas/ai-analysis/handler.py`)**

Extracted and improved from `enhance_with_bedrock()`. Changes:
- Use structured JSON prompt (as defined in Section 10)
- Parse the JSON response from Bedrock
- Return structured `anomalies` list + `summary` + `confidence`
- Keep the rate limiter and exponential backoff from the original code

**2.3 — Risk Scoring Lambda (`backend/lambdas/risk-scoring/handler.py`)**

Brand new. Responsibilities:
- Receives OCR output + AI anomalies
- Applies deterministic business rules (as defined in Section 10)
- Returns `risk_score` (0–100) and `risk_level` (LOW/MEDIUM/HIGH)

**2.4 — Store Results Lambda (`backend/lambdas/store-results/handler.py`)**

Extracted from `insert_into_db()`. Changes:
- Writes complete enriched invoice record to DynamoDB `invoices` table
- Saves extracted text to S3 (the existing 4-strategy fallback can be simplified now that we have proper config)
- Updates `processing_jobs` table with COMPLETED status
- Publishes an event to EventBridge

**2.5 — Step Functions State Machine**

File: `backend/step-functions/processing-pipeline.json`

```json
{
  "Comment": "Invoice Processing Pipeline",
  "StartAt": "OCR",
  "States": {
    "OCR": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${OCRLambdaArn}",
        "Payload.$": "$"
      },
      "Next": "AIAnalysis",
      "Retry": [{"ErrorEquals": ["States.ALL"], "MaxAttempts": 2}],
      "Catch": [{"ErrorEquals": ["States.ALL"], "Next": "HandleFailure"}]
    },
    "AIAnalysis": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${AIAnalysisLambdaArn}",
        "Payload.$": "$.Payload"
      },
      "Next": "RiskScoring",
      "Retry": [{"ErrorEquals": ["States.TaskFailed"], "MaxAttempts": 3, "IntervalSeconds": 5}],
      "Catch": [{"ErrorEquals": ["States.ALL"], "Next": "HandleFailure"}]
    },
    "RiskScoring": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${RiskScoringLambdaArn}",
        "Payload.$": "$.Payload"
      },
      "Next": "StoreResults"
    },
    "StoreResults": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${StoreResultsLambdaArn}",
        "Payload.$": "$.Payload"
      },
      "End": true
    },
    "HandleFailure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ProcessingJobsTable}",
        "Key": {"job_id": {"S.$": "$.job_id"}},
        "UpdateExpression": "SET #status = :failed",
        "ExpressionAttributeNames": {"#status": "status"},
        "ExpressionAttributeValues": {":failed": {"S": "FAILED"}}
      },
      "End": true
    }
  }
}
```

**2.6 — API Lambdas (`backend/lambdas/api/`)**

Create 3 Lambda functions:

`upload.py` — handles `POST /invoices/upload-url`:
```python
def handler(event, context):
    user_id = event['requestContext']['authorizer']['claims']['sub']
    body = json.loads(event['body'])
    
    invoice_id = f"inv_{datetime.utcnow().strftime('%Y%m%d')}_{uuid.uuid4().hex[:8]}"
    s3_key = f"invoices/{user_id}/{invoice_id}.{get_extension(body['filename'])}"
    
    # Create processing_job record in DynamoDB
    create_processing_job(invoice_id, user_id, s3_key)
    
    # Generate pre-signed URL
    presigned_url = s3.generate_presigned_url(
        'put_object',
        Params={'Bucket': UPLOADS_BUCKET, 'Key': s3_key, 'ContentType': body['content_type']},
        ExpiresIn=300
    )
    
    return success_response({'invoice_id': invoice_id, 'upload_url': presigned_url})
```

`invoices.py` — handles `GET /invoices` and `GET /invoices/{id}`:
- Lists invoices for the authenticated user from DynamoDB
- Supports filter params: `status`, `risk_level`, `from`, `to`
- Uses DynamoDB pagination with `LastEvaluatedKey`

`analytics.py` — handles `GET /analytics/*`:
- Aggregates invoice data for dashboard charts
- Groups by risk level, vendor, time period

**Expected result after Phase 2:**
Upload a file via CLI `aws s3 cp invoice.png s3://invoice-uploads-bucket/invoices/test-user/test.png`
Step Functions execution starts automatically.
Check Step Functions console — all 4 stages run in sequence.
DynamoDB `invoices` table shows a completed record with `anomalies` array and `risk_score`.

**How to test:**
```bash
# Manual test via AWS CLI
aws s3 cp invoices/invoice_1.png s3://your-upload-bucket/invoices/test/invoice_1.png

# Watch Step Functions execution
aws stepfunctions list-executions --state-machine-arn YOUR_ARN

# Check DynamoDB result
aws dynamodb scan --table-name invoices --limit 1
```

---

### Phase 3: React Frontend
**Time estimate: 8–12 hours**
**Goal:** Professional dashboard that is the face of the product.

**Why a frontend matters for interviews:**
A working UI turns a backend pipeline into a product. Interviewers can see it live. It demonstrates full-stack thinking. It's what makes the difference between "I built a script" and "I built a platform."

**Tasks:**

**3.1 — Auth and Setup**

Install dependencies:
```bash
cd frontend
npm install axios @tanstack/react-query zustand recharts
npm install aws-amplify @aws-amplify/ui-react
npm install tailwindcss @tailwindcss/forms
npm install react-router-dom
npm install -D @types/react-router-dom
```

Set up Cognito in `src/services/auth.ts`:
```typescript
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
    }
  }
});
```

Create `AuthProvider.tsx` — wraps the app, checks login state, redirects to login if not authenticated.

**3.2 — Layout**

Create `Layout.tsx` with:
- Left sidebar: logo, Dashboard link, Invoices link, Analytics link
- Top header: user name, sign out button
- Main content area

**3.3 — Upload Component (`InvoiceUpload.tsx`)**

- Drag-and-drop zone using HTML5 File API
- Validates file type client-side before upload
- On file select:
  1. Call `POST /invoices/upload-url` to get pre-signed URL
  2. Upload file directly to S3 via PUT request
  3. Show progress bar during upload
  4. Show "Processing..." status after upload
  5. Poll `GET /invoices/{id}/status` every 3 seconds until status is `completed`

**3.4 — Invoice List (`InvoiceList.tsx`)**

Table showing:
- Invoice number, vendor, date, total amount
- Risk badge (green/yellow/red based on risk_level)
- Processing status
- Action: View Details

Filters panel:
- Date range picker
- Risk level filter (dropdown: All, Low, Medium, High)
- Status filter (dropdown: All, Processing, Completed, Failed)
- Search by invoice number or vendor

Pagination with "Load more" button (DynamoDB cursor-based pagination).

**3.5 — Invoice Detail (`InvoiceDetail.tsx`)**

Full page for a single invoice showing:
- Invoice metadata (number, date, vendor, total)
- Large risk score gauge (0–100 with color gradient)
- Anomalies list — each anomaly as a card with type icon, severity badge, description
- Line items table
- AI explanation text
- Download original invoice image button

**3.6 — Analytics Dashboard**

4 charts using Recharts:
1. **Risk Distribution** (Pie chart) — count of LOW/MEDIUM/HIGH invoices
2. **Invoice Volume Over Time** (Line chart) — invoices processed per day/week
3. **Average Risk Score by Vendor** (Bar chart) — identifies problematic vendors
4. **Anomaly Type Breakdown** (Bar chart) — most common anomaly types

Summary cards at top:
- Total invoices processed
- High-risk invoices (last 30 days)
- Average processing time
- Total invoice value processed

**3.7 — Deploy Frontend**

```bash
npm run build
aws s3 sync dist/ s3://invoice-frontend-bucket/ --delete
aws cloudfront create-invalidation --distribution-id YOUR_ID --paths "/*"
```

Or automate this with GitHub Actions (Phase 5).

**Expected result after Phase 3:**
Full working web application. Log in, upload an invoice, watch it process, see the AI report with risk score and anomalies. Navigate to analytics to see charts.

---

### Phase 4: Notifications and Observability
**Time estimate: 3–4 hours**
**Goal:** The system tells you when something important happens.

**Tasks:**

**4.1 — EventBridge Rule**

In the Store Results Lambda (after successful processing), publish an event:
```python
events.put_events(Entries=[{
    'Source': 'invoice-platform',
    'DetailType': 'InvoiceProcessed',
    'Detail': json.dumps({
        'invoice_id': invoice_id,
        'tenant_id': tenant_id,
        'risk_score': risk_score,
        'risk_level': risk_level
    })
}])
```

**4.2 — SNS Alert for High-Risk Invoices**

Create an EventBridge rule that matches `risk_level = HIGH` and sends to an SNS topic.
SNS topic sends email to the authenticated user's email.

**4.3 — CloudWatch Dashboard**

Create a CDK-defined CloudWatch dashboard with:
- Lambda invocation counts and error rates for each function
- Step Functions execution success/failure rate
- DynamoDB read/write capacity usage
- API Gateway 4xx/5xx error rates
- Average invoice processing time

**4.4 — CloudWatch Alarms**

Create alarms for:
- DLQ message count > 0 (failed invoice processing)
- Lambda error rate > 5%
- Step Functions failure rate > 10%
- API Gateway 5xx > 1%

**4.5 — X-Ray Tracing**

Enable X-Ray on all Lambda functions and API Gateway:
```typescript
// In CDK
const fn = new lambda.Function(this, 'OcrFunction', {
  tracing: lambda.Tracing.ACTIVE,
  // ...
});
```

This creates a visual trace map in X-Ray console showing exactly where time is spent across the entire pipeline.

**Expected result after Phase 4:**
Upload a high-risk invoice → receive email alert. Open CloudWatch dashboard → see real-time metrics. Open X-Ray → see trace showing OCR took 2.1s, Bedrock took 3.4s, DynamoDB write took 0.1s.

---

### Phase 5: CI/CD with GitHub Actions
**Time estimate: 3–4 hours**
**Goal:** Every code change is automatically tested and deployed.

**Tasks:**

**5.1 — Backend CI/CD (`.github/workflows/backend.yml`)**

```yaml
name: Backend CI/CD

on:
  push:
    branches: [main]
    paths: ['backend/**']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: {python-version: '3.12'}
      - run: pip install pytest pytest-cov boto3 moto pydantic
      - run: pytest backend/tests/unit/ --cov=backend/lambdas

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1
      - run: cd infrastructure && npx cdk deploy ProcessingStack --require-approval never
```

**5.2 — Frontend CI/CD (`.github/workflows/frontend.yml`)**

```yaml
name: Frontend CI/CD

on:
  push:
    branches: [main]
    paths: ['frontend/**']

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: {node-version: '20'}
      - run: cd frontend && npm ci && npm run build
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1
      - run: aws s3 sync frontend/dist/ s3://${{ secrets.FRONTEND_BUCKET }} --delete
      - run: aws cloudfront create-invalidation --distribution-id ${{ secrets.CF_DISTRIBUTION_ID }} --paths "/*"
```

**5.3 — GitHub Secrets to configure:**
- `AWS_DEPLOY_ROLE_ARN` — IAM role with deploy permissions (use OIDC, not access keys)
- `FRONTEND_BUCKET` — S3 bucket name for frontend
- `CF_DISTRIBUTION_ID` — CloudFront distribution ID

**Why OIDC instead of access keys:**
GitHub Actions OIDC lets GitHub assume an IAM role directly without storing long-lived AWS credentials as secrets. This is the production-standard approach.

**Expected result after Phase 5:**
Push code to `main` → tests run → if green, Lambda functions and frontend deploy automatically to AWS.

---

### Phase 6: Tests
**Time estimate: 4–5 hours**
**Goal:** Confidence that the core pipeline logic is correct.

**Tasks:**

**6.1 — Unit tests for each Lambda**

Use `pytest` and `moto` (mock AWS SDK):

```python
# backend/tests/unit/test_ocr.py
import pytest
from moto import mock_textract
from backend.lambdas.ocr.handler import handler

@mock_textract
def test_ocr_extracts_invoice_id():
    event = {
        's3_key': 'invoices/user123/inv001.png',
        'invoice_id': 'inv001',
        'tenant_id': 'user123'
    }
    result = handler(event, None)
    assert result['invoice_id'] == 'inv001'
    assert 'line_items' in result
```

**6.2 — Unit tests for risk scoring**

```python
# backend/tests/unit/test_risk_scoring.py
def test_math_error_scores_high():
    invoice = {'total_amount': 100.00, 'line_items': [{'price': 50.00}]}
    anomalies = []
    score = calculate_risk_score(invoice, anomalies)
    assert score >= 40  # Math error alone pushes to medium+

def test_clean_invoice_scores_low():
    invoice = {'total_amount': 50.00, 'line_items': [{'price': 50.00}]}
    anomalies = []
    score = calculate_risk_score(invoice, anomalies)
    assert score < 20
```

**6.3 — Integration test for the pipeline**

Use the real 5 invoice images in `/invoices/` as test fixtures:
```python
# backend/tests/integration/test_pipeline.py
def test_full_pipeline_with_real_invoice():
    # Upload invoice to test S3 bucket
    # Wait for Step Functions execution to complete
    # Assert DynamoDB record exists with risk_score and anomalies
    pass
```

Note: Integration tests run against a real AWS test account, not mocked. Keep them separate from unit tests.

**Expected result after Phase 6:**
`pytest backend/tests/unit/` runs in under 30 seconds and passes. No AWS credentials needed for unit tests.

---

### Phase 7 (Optional): Advanced Features
**Add only after Phases 1–6 are complete.**

**7.1 — Search with DynamoDB + API filtering**
The current GSI-based filtering covers 80% of use cases. If you want full-text search (e.g., "find all invoices mentioning 'walnuts'"), add Amazon OpenSearch Service. Only add this if the use case genuinely requires it.

**7.2 — Bulk upload**
Allow uploading multiple invoice files at once via ZIP or multi-file selection. Queue all of them to SQS. SQS handles the burst naturally.

**7.3 — Export to CSV/PDF**
Add `GET /invoices/export?format=csv` endpoint. Lambda queries DynamoDB and returns a CSV file via S3 pre-signed URL.

**7.4 — Feedback loop (MLOps lite)**
Add "Mark as False Positive" button in the frontend. Store feedback in DynamoDB `feedback` table. Use aggregate feedback monthly to improve the Bedrock prompt.

**7.5 — Better AI model**
Switch from `amazon.nova-micro-v1:0` to `anthropic.claude-3-haiku-20240307-v1:0`. Test both on the existing 5 invoice images. The Haiku model has better reasoning for complex anomaly detection. Compare outputs, document the findings — this is great interview material.

---

## 12. Security and Compliance Checklist

### Authentication and Authorization
- [ ] Cognito User Pool with email verification enabled
- [ ] JWT tokens validated by API Gateway Cognito Authorizer
- [ ] `tenant_id` from Cognito `sub` enforced on every DynamoDB query
- [ ] Pre-signed S3 URLs scoped to `invoices/{tenant_id}/` prefix
- [ ] S3 buckets with `BlockPublicAccess.BLOCK_ALL`
- [ ] API Gateway access logs enabled

### Data Protection
- [ ] S3 bucket encryption: S3-managed keys (SSE-S3) at minimum
- [ ] DynamoDB encryption at rest enabled (default for new tables)
- [ ] HTTPS enforced — CloudFront redirects HTTP to HTTPS
- [ ] No secrets or credentials in Lambda environment variables — use SSM Parameter Store or Secrets Manager

### IAM Least Privilege
- [ ] Each Lambda function has its own IAM role
- [ ] OCR Lambda: only `textract:AnalyzeExpense` + `s3:GetObject` on uploads bucket
- [ ] AI Lambda: only `bedrock:InvokeModel`
- [ ] Store Lambda: only `dynamodb:PutItem` + `s3:PutObject` on processed bucket + `events:PutEvents`
- [ ] API Lambda: only `dynamodb:Query` + `dynamodb:GetItem` + `s3:GeneratePresignedUrl`

### Network Security
- [ ] VPC not required for Lambda (adds latency without benefit for this use case)
- [ ] CloudFront with WAF Web ACL — rate limiting and geo-blocking (Phase 3)
- [ ] API Gateway with throttling: 1000 requests/second default, lower for upload endpoint

### Compliance
- [ ] S3 lifecycle policies: delete raw invoices after 12 months (financial data retention)
- [ ] CloudTrail enabled in your AWS account (should already be on)
- [ ] No PII logged to CloudWatch — invoices may contain names, addresses, financial data

---

## 13. Monitoring and Observability

### What to Monitor

| Metric | Alarm Threshold | Action |
|---|---|---|
| DLQ message count | > 0 | Email alert — invoice processing failed |
| Step Functions failures | > 10% | Email alert |
| Lambda error rate (any function) | > 5% | Email alert |
| API Gateway 5xx rate | > 1% | Email alert |
| Bedrock throttling errors | > 0 | Log warning |
| Lambda duration (OCR) | > 20s | Review — Textract is slow |
| Lambda duration (AI) | > 15s | Review — Bedrock is slow |

### CloudWatch Dashboard Widgets

1. **Pipeline Health** — Step Functions execution success/failure bar chart (last 24h)
2. **Processing Volume** — Invoices processed per hour line chart
3. **Error Rate** — Lambda error percentage per function
4. **Latency** — P50/P95 processing time per pipeline stage
5. **AI Analysis** — Average confidence score over time

### X-Ray Service Map

X-Ray gives you a visual map of your entire system showing how requests flow between services. In an interview, showing this screenshot proves you understand distributed system observability.

---

## 14. CI/CD and MLOps

### CI/CD Summary

```
Developer pushes to main
        │
        ▼
GitHub Actions triggers
        │
    ┌───┴───┐
    │       │
backend   frontend
tests     build
    │       │
    ▼       ▼
CDK deploy  S3 sync +
(Lambdas)   CF invalidation
```

### Deployment Environments

Maintain two CDK stages:
- `dev` — deploys on every push to `main`
- `prod` — deploys only on tagged releases (`v1.0.0`)

This separates your development and production data.

### MLOps Loop (Lightweight)

```
User marks invoice as "False Positive"
        │
        ▼
Frontend calls POST /feedback
        │
        ▼
Lambda stores in DynamoDB feedback table
        │
Monthly: review feedback
        │
        ▼
Update Bedrock prompt in prompt_builder.py
        │
        ▼
Deploy → re-test on historical invoices
        │
        ▼
Document improvement in README
```

This is your MLOps story for interviews: "I built a feedback loop that improves the AI prompt over time based on user corrections."

---

## 15. Cost Optimization

| Service | Optimization |
|---|---|
| Lambda | Keep functions small (< 50 MB). Use ARM64 architecture (20% cheaper, 20% faster than x86) |
| DynamoDB | Use on-demand capacity for dev, provisioned capacity for prod if load is predictable |
| S3 | Intelligent-Tiering lifecycle policy moves old invoices to cheaper storage automatically |
| Bedrock | Nova Micro is the cheapest option. Only upgrade to Haiku if quality is insufficient |
| Textract | AnalyzeExpense is $0.015/page. No optimization needed at low volume |
| CloudFront | Cache the React SPA aggressively (1-year TTL for static assets) |
| Step Functions | Use Express Workflows (not Standard) — cheaper for short-lived executions under 5 minutes |

**Estimated cost for 1,000 invoices/month:**
- Lambda: ~$0 (free tier covers it)
- Textract: ~$15 (1000 × $0.015)
- Bedrock Nova Micro: ~$2 (very low token count per invoice)
- DynamoDB: ~$0 (free tier covers it)
- S3: ~$0.10
- SQS: ~$0 (free tier)
- **Total: ~$17–20/month**

---

## 16. Interview Talking Points

### System Design Questions

**"How would you scale this to 100,000 invoices/day?"**
> SQS already handles burst traffic. Lambda scales to 1000 concurrent executions by default. DynamoDB auto-scales. The only bottleneck would be Bedrock API quotas — request a quota increase or implement batching. The architecture doesn't need fundamental changes.

**"How do you ensure data consistency if Lambda fails mid-pipeline?"**
> Step Functions provides exactly-once execution semantics for each state. If the AI Analysis step fails, Step Functions retries it without re-running OCR. The DynamoDB write only happens in the final step after all processing succeeds. If the final write fails, the processing_jobs table shows FAILED and the invoice can be reprocessed.

**"Why Step Functions instead of a single Lambda?"**
> A single Lambda doing OCR + AI + storage has no retry granularity. If Bedrock fails after Textract succeeds, you'd restart the whole thing including the expensive Textract call. Step Functions lets each step retry independently. It also provides visual execution history in the console — you can see exactly which step failed for any invoice.

**"How is this multi-tenant? Can one user see another's invoices?"**
> No. Every DynamoDB query is scoped to `tenant_id = cognito_sub`. Cognito's JWT is validated by API Gateway before the request reaches any Lambda. The Lambda extracts `sub` from the verified token and hard-codes it into the DynamoDB query — a user cannot override it.

**"How does the AI detect fraud?"**
> We use a two-layer approach. First, the Bedrock LLM receives the extracted invoice text and a structured prompt asking it to identify specific anomaly types and return JSON. Second, a deterministic rules engine checks things the LLM might miss — math errors, non-standard formats, date inconsistencies. These two layers feed into a composite risk score from 0–100.

### Demonstrating Depth

Things you can say to show depth beyond the basic pipeline:

1. "I moved from a monolithic Lambda to a Step Functions pipeline because it gives me per-step retry logic, execution history, and eliminates the Lambda timeout risk on complex invoices"
2. "I changed the Bedrock prompt to require structured JSON output so I could build charts and filters on top of the AI data instead of displaying raw text"
3. "The S3 upload uses pre-signed URLs so the file goes directly to S3 without passing through API Gateway — that avoids the 10MB API Gateway payload limit and doesn't waste bandwidth on the API server"
4. "The SQS queue between S3 and Step Functions decouples the upload from processing. If Step Functions has a cold start, the message stays in SQS. If I burst upload 500 invoices, SQS queues them and processes them at a controlled rate"
5. "I use CDK for everything because the whole environment can be recreated in a new AWS account with one command. That's important for team onboarding, disaster recovery, and demoing to interviewers"
6. "I implemented a lightweight MLOps feedback loop — users can mark AI results as false positives, that data gets stored, and I use it monthly to improve the prompt. This shows the AI quality improves over time"

---

## Summary of Changes from Current State

| Aspect | Current | Target |
|---|---|---|
| Frontend | None (AWS Console only) | React SPA on CloudFront |
| API layer | None | API Gateway + Lambda REST API |
| Authentication | None | Cognito JWT |
| Processing | Single monolithic Lambda | Step Functions with 4 Lambda functions |
| Trigger | S3 → Lambda directly | S3 → SQS → Step Functions |
| AI output | Free text string | Structured JSON (type, severity, description) |
| Risk scoring | None | Numeric 0–100 score + rule engine |
| Error handling | Silent failure | DLQ + CloudWatch alarms + SNS alerts |
| Infrastructure | Manual console setup | AWS CDK (TypeScript) |
| CI/CD | Manual copy-paste | GitHub Actions |
| Tests | None | Unit tests with moto + integration tests |
| Observability | Basic CloudWatch logs | CloudWatch Dashboard + X-Ray + Alarms |
| Multi-tenancy | None (all in one table) | Cognito sub as tenant_id |
| Search/filter | None | GSI-based filtering + pagination |
| Analytics | None | Charts dashboard |

---

*Start with Phase 0. Confirm each phase is working before moving to the next. Each phase is independently deployable and testable.*
