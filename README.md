# NovaMind Ai Invoice Intelligence Platform

> AI-powered serverless invoice processing with anomaly detection, risk scoring, and a full React dashboard — built on AWS.

**Created by [Aamir](https://github.com/aamir490)** · [LinkedIn](https://www.linkedin.com/in/aamir-imran)


---

## Screenshots
### Dashboard
![Dashboard](project_pic/login_page.png)

### Dashboard
![Dashboard](project_pic/dashboard1.png)

### Uploaded Invoice — Processed with AI Risk Score
![Invoice Detail](project_pic/uploaded_invoice2.png)

### Analytics
![Analytics](project_pic/analytics_3.png)

---

## For Deployment use - 
- **deploy_project_via_clone.md**

## What This Does

Upload an invoice image → Amazon Textract extracts every field → Amazon Bedrock AI detects anomalies → a rules engine scores the risk 0–100 → results are stored in DynamoDB → everything is displayed in a React dashboard with charts, filters, and per-invoice detail views.

**No servers. No manual steps. Fully automated end to end.**

---

## How It Works — Complete Data Flow

```
Step 1 — User uploads invoice
─────────────────────────────
Browser → POST /invoices/upload-url (with Cognito JWT)
       ← API returns a pre-signed S3 URL (5 min expiry)
Browser → PUT file directly to S3 (no API Gateway in the path)

Step 2 — S3 triggers the pipeline
──────────────────────────────────
S3 ObjectCreated event
  → SQS Queue (decouples upload from processing)
    → SQS Trigger Lambda
      → Step Functions Express starts with payload:
        { invoice_id, tenant_id, s3_key, job_id }

Step 3 — Step Functions pipeline (4 stages)
────────────────────────────────────────────
Stage 1: OCR Lambda
  - Calls Textract AnalyzeExpense
  - Extracts: vendor, dates, total, line items, subtotal, tax
  - Returns structured invoice_data + raw text_lines

Stage 2: AI Analysis Lambda
  - Builds a structured JSON-schema prompt
  - Calls Bedrock Nova Micro
  - Returns: anomalies[], summary, confidence score
  - Non-fatal: pipeline continues even if Bedrock is throttled

Stage 3: Risk Scoring Lambda
  - Deterministic rules: math error check, missing fields,
    duplicate line items, non-standard invoice number
  - Combines with AI anomalies
  - Produces: risk_score (0–100) + LOW / MEDIUM / HIGH

Stage 4: Store Results Lambda
  - Writes complete invoice record to DynamoDB
  - Saves extracted text to S3 (processed bucket)
  - Fires EventBridge InvoiceProcessed event
  - Updates job status to COMPLETED

Step 4 — Browser reads results
──────────────────────────────
Browser polls GET /invoices/{id}/status → COMPLETED
Browser loads GET /invoices/{id}        → full invoice detail

Step 5 — High-risk alert
─────────────────────────
EventBridge Rule (risk_level = HIGH)
  → SNS Topic → Email alert
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Browser                           │
│              React SPA (Vite + Tailwind)            │
└──────────────┬──────────────────────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────────────────────┐
│              CloudFront (CDN + HTTPS)                │
└──────────────┬──────────────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼──────┐  ┌──────▼───────────────────────────┐
│   Cognito   │  │         API Gateway REST           │
│  User Pool  │  │  /invoices  /analytics  /upload   │
│  (JWT Auth) │  └──────┬───────────────────────────┘
└─────────────┘         │
                ┌───────┼──────────┐
                │       │          │
          ┌─────▼──┐ ┌──▼───┐ ┌───▼──────┐
          │ upload │ │ invs │ │analytics │  ← Lambda functions
          └─────┬──┘ └──┬───┘ └───┬──────┘
                │       │         │
                └───────┴─────────┘
                            │
                       ┌────▼────┐
                       │DynamoDB │
                       │invoices │
                       │  jobs   │
                       └─────────┘
                            ▲
S3 Upload                   │
    │                       │
    ▼                       │
  SQS ──► Lambda ──► Step Functions Express
                         │
              ┌──────────┼──────────┬──────────┐
              │          │          │          │
          ┌───▼───┐ ┌────▼──┐ ┌────▼───┐ ┌───▼─────┐
          │  OCR  │ │  AI   │ │  Risk  │ │  Store  │
          │Textract│ │Bedrock│ │ Rules  │ │DynamoDB │
          └───────┘ └───────┘ └────────┘ └─────────┘
                                              │
                                    EventBridge ──► SNS
                                    CloudWatch + X-Ray
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Recharts |
| State management | Zustand + React Query |
| Auth | Amazon Cognito (SRP flow, JWT tokens) |
| API | Amazon API Gateway REST + Lambda (Python 3.12, ARM64) |
| Processing pipeline | AWS Step Functions Express |
| OCR | Amazon Textract `AnalyzeExpense` |
| AI / LLM | Amazon Bedrock — Nova Micro (structured JSON output) |
| Risk scoring | Custom rules engine (Python) |
| Database | Amazon DynamoDB (on-demand, multi-tenant) |
| Storage | Amazon S3 (uploads + processed text + frontend) |
| CDN | Amazon CloudFront |
| Alerting | Amazon EventBridge + SNS |
| Tracing | AWS X-Ray |
| Infrastructure | AWS CDK v2 (TypeScript) — 5 stacks |
| CI/CD | GitHub Actions with OIDC (no stored AWS keys) |

---

## Project Structure

```
NovaMind-Ai-Invoice-Intelligence/
│
├── backend/
│   ├── lambdas/
│   │   ├── ocr/                # Stage 1: Textract AnalyzeExpense
│   │   │   ├── handler.py
│   │   │   └── parser.py
│   │   ├── ai_analysis/        # Stage 2: Bedrock anomaly detection
│   │   │   ├── handler.py
│   │   │   └── prompt_builder.py
│   │   ├── risk_scoring/       # Stage 3: Rules engine (score 0–100)
│   │   │   ├── handler.py
│   │   │   └── rules.py
│   │   ├── store_results/      # Stage 4: DynamoDB + EventBridge
│   │   │   └── handler.py
│   │   ├── sqs_trigger/        # SQS → Step Functions bridge
│   │   │   └── handler.py
│   │   ├── api/                # REST API handlers
│   │   │   ├── upload.py       # POST /invoices/upload-url
│   │   │   ├── invoices.py     # GET/DELETE /invoices
│   │   │   └── analytics.py    # GET /analytics/*
│   │   └── shared/             # Shared across all Lambdas
│   │       ├── db.py           # DynamoDB helpers
│   │       ├── models.py       # Pydantic data models
│   │       ├── exceptions.py   # Custom exceptions
│   │       └── response.py     # API response helpers + CORS
│   ├── step-functions/
│   │   └── processing-pipeline.json
│   └── tests/
│       └── unit/               # pytest unit tests (no AWS needed)
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── DashboardPage.tsx
│       │   ├── InvoicesPage.tsx
│       │   ├── InvoiceDetailPage.tsx
│       │   └── AnalyticsPage.tsx
│       ├── components/
│       │   ├── layout/         # Sidebar, Header, Layout
│       │   ├── invoices/       # InvoiceList, InvoiceUpload, InvoiceCard
│       │   └── analytics/      # Charts, KPI cards
│       ├── services/
│       │   ├── api.ts          # Axios client + interceptors
│       │   ├── auth.ts         # AWS Amplify auth
│       │   └── upload.ts       # S3 presigned upload
│       ├── store/              # Zustand: auth, filters, upload state
│       └── types/              # TypeScript interfaces
│
├── infrastructure/             # AWS CDK v2 — 5 stacks
│   └── lib/
│       ├── storage-stack.ts    # S3 (3 buckets) + DynamoDB (2 tables) + SQS
│       ├── auth-stack.ts       # Cognito User Pool + Web Client
│       ├── processing-stack.ts # Step Functions + 5 Lambdas + EventBridge + SNS
│       ├── api-stack.ts        # API Gateway + 3 API Lambdas + Cognito auth
│       └── frontend-stack.ts   # CloudFront + S3 static hosting
│
├── .github/workflows/
│   ├── backend.yml             # pytest + CDK deploy on push to main
│   ├── frontend.yml            # build + S3 deploy + CloudFront invalidation
│   └── pr-checks.yml          # tests + cdk synth on every PR
│
├── invoices/                   # Sample invoice images for testing
├── project_pic/                # Screenshots
├── deploy_project_via_clone.md # Step-by-step deploy guide for new users
└── .env.example                # Environment variable reference
```

---

## AWS Services Used

| Service | Purpose |
|---------|---------|
| **S3** | Invoice file uploads, extracted text storage, frontend static hosting |
| **DynamoDB** | Invoice records and processing job status (multi-tenant, PAY_PER_REQUEST) |
| **SQS + DLQ** | Decouples S3 upload events from processing pipeline |
| **AWS Lambda** | 8 functions — 5 pipeline + 3 API (ARM64, Python 3.12) |
| **Step Functions Express** | Orchestrates 4-stage pipeline with retry and error handling |
| **Amazon Textract** | `AnalyzeExpense` — extracts structured fields from invoice images |
| **Amazon Bedrock** | Nova Micro LLM for AI anomaly detection (structured JSON output) |
| **API Gateway REST** | REST API with Cognito JWT authorization and CORS |
| **Amazon Cognito** | User authentication — SRP flow, JWT tokens as tenant IDs |
| **CloudFront** | HTTPS CDN for React SPA with SPA routing fallback |
| **EventBridge + SNS** | HIGH risk invoice alerts |
| **CloudWatch + X-Ray** | Logs, alarms, and distributed tracing |
| **AWS CDK v2** | Infrastructure as Code — 5 separate stacks |

---

## Key Design Decisions

**Why Step Functions instead of one big Lambda?**
Per-stage retry without re-running expensive Textract calls. Visual execution graph for debugging. Failure isolation — one stage failing doesn't corrupt the others.

**Why SQS between S3 and Step Functions?**
S3 can't invoke Step Functions directly. SQS buffers burst uploads, handles retries via visibility timeout, and sends poison-pill messages to a DLQ after 3 failed attempts.

**Why pre-signed S3 URLs for file upload?**
The file goes directly from the browser to S3 — bypasses API Gateway's 10MB payload limit and saves Lambda bandwidth costs entirely.

**Why structured JSON output from Bedrock?**
Free-text AI output can't be filtered, sorted, or charted. A JSON schema prompt forces the model to return typed anomaly objects that power every dashboard feature.

**Why both AI and a rules engine for risk scoring?**
AI catches nuanced issues (unusual prices, date inconsistencies). The rules engine catches math errors and missing fields with 100% reliability. The combined score is more robust than either alone.

**Why multi-tenant isolation via Cognito `sub`?**
The Cognito `sub` (UUID) from the JWT becomes the DynamoDB partition key. Every query includes `KeyConditionExpression: tenant_id = :sub` — one tenant can never see another's data without changing a single line of application logic.

---

## Cost Estimate (1,000 invoices/month)

| Service | Estimated Cost |
|---------|---------------|
| Amazon Textract | ~$15 |
| Amazon Bedrock (Nova Micro) | ~$2 |
| Lambda (all 8 functions) | ~$0 (free tier) |
| DynamoDB | ~$0 (free tier) |
| S3 | ~$0.10 |
| SQS | ~$0 (free tier) |
| CloudFront | ~$0.10 |
| **Total** | **~$17–20 / month** |

---

## Deploy This Project

See **[deploy_project_via_clone.md](deploy_project_via_clone.md)** for the complete step-by-step deployment guide.

Quick overview:
1. `aws configure` — set up your AWS credentials
2. Enable Bedrock Nova Micro model access in AWS Console
3. `cd infrastructure && npm ci && npx cdk bootstrap`
4. Build the Lambda layer (shared Python code)
5. `npx cdk deploy --all --context env=dev`
6. Run `fix-layer.ps1` to attach the layer to all functions
7. Create `frontend/.env.local` with CDK output values
8. `cd frontend && npm run dev` → open http://localhost:5173

---

## Run Unit Tests

```bash
pip install -r backend/tests/requirements-test.txt
cd backend
pytest tests/unit/ -v
```

All tests run without AWS credentials using pure Python logic.

---

## CI/CD (GitHub Actions)

Every push to `main` automatically:
1. Runs Python unit tests with coverage
2. Deploys infrastructure changes via CDK (OIDC — no stored AWS keys)
3. Builds the React app
4. Syncs to S3 and invalidates CloudFront cache

Add these secrets in GitHub → Settings → Secrets → Actions:

| Secret | Source |
|--------|--------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role with OIDC trust for GitHub Actions |
| `VITE_API_URL` | CDK output: `ApiUrl` |
| `VITE_COGNITO_USER_POOL_ID` | CDK output: `UserPoolId` |
| `VITE_COGNITO_USER_POOL_CLIENT_ID` | CDK output: `UserPoolClientId` |
| `FRONTEND_BUCKET` | CDK output: `FrontendBucketName` |
| `CF_DISTRIBUTION_ID` | CDK output: `DistributionId` |

---

## Author

**Aamir**
- GitHub: [github.com/aamir490](https://github.com/aamir490)
- LinkedIn: [linkedin.com/in/aamir-imran](https://www.linkedin.com/in/aamir-imran)
