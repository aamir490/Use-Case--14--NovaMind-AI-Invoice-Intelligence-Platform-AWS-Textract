# AI Invoice Intelligence Platform — Complete Production Roadmap

> Think like a Senior AWS Solutions Architect + AI/ML Engineer + MLOps Engineer + Full-Stack Engineer.
> This document is your single source of truth from current broken state → production-ready interview project.

---

## Table of Contents

1. [Current Architecture](#1-current-architecture)
2. [Target Architecture](#2-target-architecture)
3. [Step-by-Step Implementation](#3-step-by-step-implementation)
4. [Production Features Reference](#4-production-features-reference)
5. [Final End-to-End Test](#5-final-end-to-end-test)
6. [Interview Preparation](#6-interview-preparation)

---

## 1. Current Architecture

### 1.1 Folder / File Structure

```
Trigger_OCR_Function_FM_NoSQL/
├── lambda_function.py              ← Original monolithic Lambda (archive/reference only)
├── .env.example                    ← Environment variable reference
├── .gitignore
├── .github/
│   └── workflows/
│       ├── backend.yml             ← CI: pytest + CDK deploy on push to main
│       ├── frontend.yml            ← CI: TypeScript build + S3 deploy
│       └── pr-checks.yml          ← CI: tests + cdk synth on every PR
├── backend/
│   ├── lambdas/
│   │   ├── shared/                 ← Shared utilities (BUG: not bundled into Lambdas)
│   │   │   ├── db.py              ← DynamoDB CRUD helpers
│   │   │   ├── models.py          ← Pydantic data models
│   │   │   ├── exceptions.py      ← Custom exceptions
│   │   │   ├── response.py        ← API Gateway response helpers + CORS
│   │   │   └── __init__.py
│   │   ├── ocr/
│   │   │   ├── handler.py         ← Step 1: Textract AnalyzeExpense
│   │   │   └── parser.py          ← Textract response → structured dict
│   │   ├── ai_analysis/
│   │   │   ├── handler.py         ← Step 2: Bedrock Nova Micro anomaly detection
│   │   │   └── prompt_builder.py  ← Structured JSON prompt for Bedrock
│   │   ├── risk_scoring/
│   │   │   ├── handler.py         ← Step 3: Combined deterministic + AI risk score
│   │   │   └── rules.py           ← Math check, missing fields, duplicate items
│   │   ├── store_results/
│   │   │   └── handler.py         ← Step 4: DynamoDB write + EventBridge publish
│   │   ├── sqs_trigger/
│   │   │   └── handler.py         ← SQS → Step Functions bridge
│   │   └── api/
│   │       ├── upload.py          ← POST /invoices/upload-url (presigned URL)
│   │       ├── invoices.py        ← GET/DELETE /invoices[/{id}[/status]]
│   │       └── analytics.py       ← GET /analytics/summary|risk-trend|vendor-stats|anomaly-types
│   ├── step-functions/
│   │   └── processing-pipeline.json  ← Step Functions ASL definition
│   └── tests/
│       ├── pytest.ini
│       ├── requirements-test.txt
│       └── unit/
│           ├── test_ocr_parser.py
│           ├── test_risk_scoring.py
│           ├── test_prompt_builder.py
│           └── test_api_response.py
├── infrastructure/                 ← AWS CDK v2 TypeScript
│   ├── bin/app.ts                 ← CDK app entry point (5 stacks)
│   └── lib/
│       ├── storage-stack.ts       ← S3 (3 buckets) + DynamoDB (2 tables) + SQS
│       ├── auth-stack.ts          ← Cognito User Pool + Web Client
│       ├── processing-stack.ts    ← Step Functions + 5 processing Lambdas
│       ├── api-stack.ts           ← API Gateway REST + Cognito authorizer + 3 API Lambdas
│       └── frontend-stack.ts      ← CloudFront + S3 static hosting
└── frontend/                      ← React 18 + TypeScript + Vite + Tailwind
    └── src/
        ├── App.tsx                ← Router + ProtectedRoute
        ├── pages/                 ← LoginPage, DashboardPage, InvoicesPage,
        │                             InvoiceDetailPage, AnalyticsPage
        ├── components/            ← layout/, invoices/, analytics/
        ├── services/              ← api.ts (axios), auth.ts (Amplify), upload.ts
        ├── store/index.ts         ← Zustand: auth, filters, upload tracking
        └── types/                 ← TypeScript interfaces
```

### 1.2 What Each Major Component Does

| Component | Responsibility |
|-----------|---------------|
| `lambda_function.py` (root) | Original monolithic proof-of-concept. Not deployed. Reference only. |
| `shared/db.py` | DynamoDB helper functions: put_invoice, get_invoice, list_invoices, create_job, update_job_status |
| `shared/models.py` | Pydantic v2 models: Invoice, ProcessingJob, Anomaly, PipelinePayload, enums |
| `shared/response.py` | API Gateway response builders with CORS headers. get_tenant_id() extracts Cognito sub claim |
| `ocr/handler.py` | Calls Textract.analyze_expense(), delegates parsing, updates job status to OCR stage |
| `ocr/parser.py` | Converts raw Textract ExpenseDocument → structured invoice dict + text_lines list |
| `ai_analysis/handler.py` | Calls Bedrock Nova Micro, retries on throttle, parses JSON anomaly report. Non-fatal on failure |
| `ai_analysis/prompt_builder.py` | Builds deterministic JSON-schema prompt so model output is machine-readable |
| `risk_scoring/handler.py` | Merges AI anomalies + deterministic rule results into numeric score 0–100 + LOW/MEDIUM/HIGH level |
| `risk_scoring/rules.py` | Math error check (1% tolerance), missing fields, non-standard invoice number, duplicate line items |
| `store_results/handler.py` | Writes final invoice record to DynamoDB, saves text to S3, fires EventBridge InvoiceProcessed event |
| `sqs_trigger/handler.py` | Reads S3 event from SQS, extracts tenant_id from key path, starts Step Functions Express execution |
| `api/upload.py` | Generates S3 pre-signed PUT URL, creates job record. Tenant is the Cognito sub claim |
| `api/invoices.py` | CRUD: list (paginated cursor), get, delete with S3 cleanup, status check |
| `api/analytics.py` | Tenant-scoped aggregations: KPI summary, risk trend by day, vendor stats, anomaly type breakdown |

### 1.3 AWS Services Currently Used

| Service | Stack | Purpose |
|---------|-------|---------|
| S3 (3 buckets) | StorageStack | invoice-uploads (S3 versioned + lifecycle), invoice-processed (text output), invoice-frontend (SPA static files) |
| DynamoDB (2 tables) | StorageStack | invoices (PK: tenant_id, SK: invoice_id, 2 GSIs), processing_jobs (PK: job_id, TTL) |
| SQS + DLQ | StorageStack | Decouples S3 upload event from Step Functions. DLQ retains failed messages 14 days |
| Cognito User Pool | AuthStack | SRP auth, email sign-up, JWT tokens used by API Gateway authorizer |
| Step Functions Express | ProcessingStack | Orchestrates OCR → AI → Risk → Store pipeline. Express = high volume, logs to CloudWatch |
| Lambda (8 functions) | Processing + Api | ARM64/Python 3.12 across all functions |
| Amazon Textract | ProcessingStack | analyze_expense() for invoice-specific structured extraction |
| Amazon Bedrock (Nova Micro) | ProcessingStack | Anomaly detection via LLM with structured JSON output |
| EventBridge | ProcessingStack | Custom bus `invoice-platform`, fires InvoiceProcessed event for HIGH risk SNS alerts |
| SNS | ProcessingStack | High-risk invoice alert topic |
| CloudWatch Alarms | ProcessingStack | DLQ message count alarm → SNS |
| API Gateway REST | ApiStack | /invoices and /analytics routes, Cognito JWT authorizer, X-Ray tracing |
| CloudFront | FrontendStack | HTTPS CDN for React SPA, OAC to S3, SPA 404→index.html fallback |
| X-Ray | ProcessingStack + ApiStack | Distributed tracing across Lambdas and API Gateway |

### 1.4 Complete Invoice Data Flow

```
User Browser
    │
    │  1. POST /invoices/upload-url   (JWT in Authorization header)
    ▼
API Gateway  →  upload Lambda
    │               │
    │               ├─ Validates content type (PNG/JPG/PDF/TIFF)
    │               ├─ Generates invoice_id = inv_{date}_{8hex}
    │               ├─ Creates processing_job record in DynamoDB (status=PENDING)
    │               └─ Returns pre-signed S3 PUT URL (5 min expiry)
    │
    │  2. PUT (direct to S3, no API Gateway)
    ▼
S3 invoice-uploads bucket
    │
    │  3. S3 ObjectCreated event  →  SQS queue (prefix: invoices/)
    ▼
SQS processing queue
    │
    │  4. Lambda trigger (batch=1)
    ▼
sqs_trigger Lambda
    │   ├─ Parses S3 key: invoices/{tenant_id}/{invoice_id}.ext
    │   ├─ Creates/updates job record
    │   └─ Starts Step Functions execution with PipelinePayload
    │
    ▼
Step Functions Express Workflow
    │
    ├─ Step 1: OCR Lambda
    │       ├─ Updates job status → PROCESSING/OCR
    │       ├─ Validates file extension
    │       ├─ Calls Textract.analyze_expense()
    │       ├─ parser.py → invoice_data + text_lines
    │       └─ Returns event + ocr_data
    │
    ├─ Step 2: AI Analysis Lambda
    │       ├─ Updates job status → PROCESSING/AI_ANALYSIS
    │       ├─ Builds structured prompt with invoice fields + raw text
    │       ├─ Calls Bedrock Nova Micro (retries on throttle, non-fatal on failure)
    │       ├─ Parses JSON anomaly report
    │       └─ Returns event + ai_result {anomalies, summary, confidence}
    │
    ├─ Step 3: Risk Scoring Lambda
    │       ├─ Updates job status → PROCESSING/RISK_SCORING
    │       ├─ Runs deterministic rules (math check, missing fields, duplicates)
    │       ├─ Combines with AI anomalies
    │       ├─ Calculates score 0–100 → LOW/MEDIUM/HIGH
    │       └─ Returns event + risk_score + risk_level + all_anomalies
    │
    └─ Step 4: Store Results Lambda
            ├─ Updates job status → PROCESSING/STORING
            ├─ Writes full invoice record to DynamoDB invoices table
            ├─ Saves extracted text to S3 processed bucket
            ├─ Fires EventBridge InvoiceProcessed event
            ├─ Updates job status → COMPLETED/DONE
            └─ Returns final summary

On HIGH risk:
EventBridge Rule  →  SNS HighRisk topic  →  Email/Webhook alert

Frontend polling:
    GET /invoices/{id}/status  (polls until COMPLETED or FAILED)
    GET /invoices/{id}         (loads full invoice detail)
```

---

## 2. Target Architecture

### 2.1 Recommended Final Architecture

```
                          ┌─────────────────────────────────────────────────┐
                          │              User / Browser                     │
                          └───────────────────┬─────────────────────────────┘
                                              │ HTTPS
                          ┌───────────────────▼─────────────────────────────┐
                          │         CloudFront Distribution                 │
                          │   (React SPA, HTTPS-only, OAC, SPA fallback)   │
                          └───────────────────┬─────────────────────────────┘
                                              │
                   ┌──────────────────────────┼──────────────────────────────┐
                   │                          │                              │
          ┌────────▼────────┐     ┌───────────▼──────────┐     ┌────────────▼────────┐
          │  Cognito         │     │   API Gateway REST    │     │   S3 (direct PUT)   │
          │  User Pool       │     │   /v1 (JWT auth)      │     │   Pre-signed URL    │
          │  (SRP auth)      │     └───────────┬──────────┘     └─────────────────────┘
          └─────────────────┘                 │
                                  ┌───────────┼─────────────┐
                                  │           │             │
                         ┌────────▼──┐  ┌─────▼────┐  ┌───▼──────────┐
                         │  upload   │  │ invoices │  │  analytics   │
                         │  Lambda   │  │  Lambda  │  │   Lambda     │
                         └─────┬─────┘  └─────┬────┘  └──────────────┘
                               │              │
                               ▼              ▼
                         ┌─────────────────────────────────────────┐
                         │           DynamoDB                      │
                         │  invoices-{env}   processing-jobs-{env} │
                         │  GSIs: status-created, risk-level       │
                         └─────────────────────────────────────────┘
                                              ▲
S3 ObjectCreated                              │
     │                                        │
     ▼                                        │
   SQS → sqs_trigger Lambda → Step Functions Express
                                    │
                              ┌─────┴──────┐
                              │            │
                        ┌─────▼─────┐  ┌──▼──────────┐
                        │  Textract  │  │   Bedrock   │
                        │AnalyzeExp  │  │ Nova Micro  │
                        └───────────┘  └─────────────┘
                                              │
                                    EventBridge → SNS (HIGH risk)
                                    CloudWatch Logs + X-Ray
                                    CloudWatch Alarms (DLQ, errors)
```

### 2.2 Component Justification

| Component | Why It's Needed |
|-----------|----------------|
| **CloudFront + S3** | Serves the React SPA globally over HTTPS with edge caching. S3 alone can't do HTTPS on custom paths or SPA routing. Already implemented in FrontendStack. |
| **API Gateway REST + Cognito** | Stateless JWT auth without managing session infrastructure. Cognito sub claim becomes tenant_id — no extra user table needed. Already implemented. |
| **Lambda Layer for `shared/`** | **Critical missing piece.** Without it all 5 processing Lambdas throw `No module named 'shared'` at runtime. Layer makes shared code importable as a proper Python package. |
| **Step Functions Express** | Orchestrates 4-step pipeline with built-in retry, catch, and state passing. Express is cheaper and faster for high-volume short-duration workflows vs. Standard. Already implemented. |
| **Textract AnalyzeExpense** | Purpose-built invoice OCR. Returns structured fields (VENDOR, TOTAL, LINE_ITEMS) without any ML model training. Better than Detect/Analyze for invoices. |
| **Bedrock (Nova Micro)** | Fast, cheap LLM for anomaly detection narrative. Nova Micro costs ~$0.000035 per 1K tokens. Structured JSON prompt ensures machine-readable output. |
| **DynamoDB PAY_PER_REQUEST** | Zero ops, scales to zero, handles burst traffic. Two GSIs cover the query patterns (by status, by risk level). No relational schema needed here. |
| **SQS + DLQ** | Decouples S3 upload events from processing. If Step Functions is throttled, SQS holds the message. DLQ captures poison-pill messages after 3 retries. |
| **EventBridge + SNS** | Event-driven alerting for HIGH risk invoices. Extensible: add more targets (Slack webhook, ticket system) without changing Lambda code. |
| **GitHub Actions OIDC** | Keyless AWS auth in CI/CD. No long-lived access keys stored as secrets. Assumed role has minimum required permissions. Already implemented. |
| **X-Ray** | Distributed tracing across API Gateway → Lambda → DynamoDB → Textract/Bedrock. Essential for diagnosing latency in multi-step pipelines. Already enabled. |
| **CloudWatch Alarms** | DLQ alarm already exists. Need to add Lambda error rate and Step Functions failure alarms for full observability. |

---

## 3. Step-by-Step Implementation

> Each step includes: What, Why, Files, Commands, Expected Result, Verification, Common Errors.

---

### PHASE 1 — Fix the Critical Bug (Lambda Shared Layer)

---

### Step 1 — Fix `shared` Module: Create a Lambda Layer

**What:** Package `backend/lambdas/shared/` as a Lambda Layer so all processing Lambdas can import it.

**Why:** Lambda deploys each function's code folder as a zip. The `shared/` folder is a sibling directory, not inside the function zip. Lambda's Python runtime adds `/opt/python` from layers to `sys.path` automatically, making `from shared.db import ...` work without `sys.path.insert` hacks.

**Files to modify:** `infrastructure/lib/processing-stack.ts`

**Change:** Add the `SharedLayer` definition and attach `layers: [sharedLayer]` to all 5 processing Lambdas AND the `sqs_trigger` Lambda.

```typescript
// In ProcessingStack constructor, BEFORE the sharedEnv block:

const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
  layerVersionName: `invoice-shared-${envName}`,
  code: lambda.Code.fromAsset(path.join(lambdaRoot, 'shared'), {
    bundling: {
      image: lambda.Runtime.PYTHON_3_12.bundlingImage,
      command: [
        'bash', '-c',
        'mkdir -p /asset-output/python && cp -r /asset-input/* /asset-output/python/',
      ],
      local: {
        tryBundle(outputDir: string): boolean {
          const fs = require('fs');
          const srcDir = path.join(lambdaRoot, 'shared');
          const destDir = path.join(outputDir, 'python');
          fs.mkdirSync(destDir, { recursive: true });
          for (const f of fs.readdirSync(srcDir)) {
            const src = path.join(srcDir, f);
            const dst = path.join(destDir, f);
            if (fs.statSync(src).isFile()) fs.copyFileSync(src, dst);
          }
          return true;
        },
      },
    },
  }),
  compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
  description: 'Shared utilities: db, models, exceptions, response helpers',
});
```

Then add `layers: [sharedLayer]` to each of these 5 Lambda definitions:
- `OcrFunction`
- `AIAnalysisFunction`
- `RiskScoringFunction`
- `StoreResultsFunction`
- `SQSTriggerFunction`

**Also fix `sys.path` hacks:** The `sys.path.insert(0, ...)` lines in each handler are no longer needed once the layer is in place. They don't cause failures but are misleading. Leave them as harmless fallbacks for now; remove when confident.

**Commands (PowerShell from `infrastructure/`):**
```powershell
npm run build        # compile TypeScript
npx cdk synth        # validate — must produce no errors
npx cdk deploy InvoiceProcessing-dev --context env=dev --require-approval never
```

**Expected result:** CloudFormation creates a new `invoice-shared-dev` Lambda Layer version and updates all 5 function configurations.

```text
Outputs:
InvoiceProcessing-dev.AlertTopicArn = arn:aws:sns:us-east-1:637423369471:invoice-high-risk-alerts-dev
InvoiceProcessing-dev.StateMachineArn = arn:aws:states:us-east-1:637423369471:stateMachine:invoice-processing-pipeline-dev
Stack ARN:
arn:aws:cloudformation:us-east-1:637423369471:stack/InvoiceProcessing-dev/18d2e580-a048-11f1-b8a4-12ef2f0f3223
```



**Verification:**
```powershell
# Test the OCR Lambda directly to confirm no import error
aws lambda invoke `
  --function-name invoice-ocr-dev `
  --payload (([System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{"invoice_id":"test","tenant_id":"t1","s3_key":"invoices/t1/test.png","job_id":"job_test"}')))) `
  --cli-binary-format raw-in-base64-out `
  response.json
Get-Content response.json
```
You should see a Textract error (no real file), NOT `No module named 'shared'`.

**Common errors:**

| Error | Fix |
|-------|-----|
| `No module named 'shared'` still appears | Layer wasn't attached — check `layers: [sharedLayer]` is present on the function. Redeploy. |
| `bundling failed` during `cdk synth` | Docker not running. The `local.tryBundle` fallback handles this on Windows — ensure Node can access `fs`. |
| `Runtime.ImportModuleError: No module named 'pydantic'` | Add pydantic to layer: install it into the layer's `python/` dir via pip before copying. See Step 2. |

---

### Step 2 — Add Python Dependencies to the Layer

**What:** Install `pydantic` and `boto3` into the layer so they're available without bundling per-function.

**Why:** `models.py` uses Pydantic. Lambda includes `boto3` in the runtime but at an older version. Pinning it in the layer ensures consistency.

**Create file:** `backend/lambdas/shared/requirements.txt`
```
pydantic>=2.0.0,<3.0.0
boto3>=1.34.0
```

**Update the layer bundling command** in `processing-stack.ts`:
```typescript
command: [
  'bash', '-c',
  [
    'pip install -r /asset-input/requirements.txt -t /asset-output/python --quiet',
    'cp -r /asset-input/*.py /asset-input/__init__.py /asset-output/python/ 2>/dev/null || true',
  ].join(' && '),
],
local: {
  tryBundle(outputDir: string): boolean {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const srcDir = path.join(lambdaRoot, 'shared');
    const destDir = path.join(outputDir, 'python');
    fs.mkdirSync(destDir, { recursive: true });
    // Install Python deps
    const req = path.join(srcDir, 'requirements.txt');
    if (fs.existsSync(req)) {
      execSync(`pip install -r "${req}" -t "${destDir}" --quiet`);
    }
    // Copy source files
    for (const f of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, f);
      if (fs.statSync(src).isFile() && f.endsWith('.py')) {
        fs.copyFileSync(src, path.join(destDir, f));
      }
    }
    return true;
  },
},
```

**Commands:**
```powershell
npx cdk deploy InvoiceProcessing-dev --context env=dev --require-approval never
```

**Verification:**
```powershell
aws logs filter-log-events `
  --log-group-name /aws/lambda/invoice-ocr-dev `
  --limit 5 `
  --query "events[*].message" --output text
```
Should see `[OCR] Processing` log lines, not import errors.

```
Outputs:
InvoiceProcessing-dev.AlertTopicArn = arn:aws:sns:us-east-1:637423369471:invoice-high-risk-alerts-dev
InvoiceProcessing-dev.StateMachineArn = arn:aws:states:us-east-1:637423369471:stateMachine:invoice-processing-pipeline-dev
Stack ARN:
arn:aws:cloudformation:us-east-1:637423369471:stack/InvoiceProcessing-dev/18d2e580-a048-11f1-b8a4-12ef2f0f3223
```


---

### Step 3 — Also Fix the API Stack Shared Module

**What:** The API Lambdas (upload, invoices, analytics) also import from `shared/`. They live in `api-stack.ts` and need the same layer.

**Files to modify:** `infrastructure/lib/api-stack.ts`

**Change:** Add the same `SharedLayer` definition to `api-stack.ts` and attach it to `uploadLambda`, `invoicesLambda`, `analyticsLambda`.

> Since the layer is defined in two stacks, extract it to a helper or accept the duplication. The simplest approach for now is to define it identically in `api-stack.ts`.

Add near the top of the ApiStack constructor:
```typescript
const sharedLayer = new lambda.LayerVersion(this, 'ApiSharedLayer', {
  layerVersionName: `invoice-api-shared-${envName}`,
  code: lambda.Code.fromAsset(path.join(lambdaRoot, 'shared'), {
    // same bundling config as ProcessingStack
  }),
  compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
});
```

Add `layers: [sharedLayer]` to all three API Lambda definitions.

**Commands:**
```powershell
npx cdk deploy InvoiceApi-dev --context env=dev --require-approval never
```

```
Outputs:
InvoiceApi-dev.ApiId = y4ny8fyzcb
InvoiceApi-dev.ApiUrl = https://y4ny8fyzcb.execute-api.us-east-1.amazonaws.com/v1/
InvoiceApi-dev.ExportsOutputRefInvoiceApi80B02230D7186087 = y4ny8fyzcb
InvoiceApi-dev.ExportsOutputRefInvoiceApiDeploymentStagev16CCB5B0D1797EB95 = v1
InvoiceApi-dev.InvoiceApiEndpointD83ED6AB = https://y4ny8fyzcb.execute-api.us-east-1.amazonaws.com/v1/
Stack ARN:
arn:aws:cloudformation:us-east-1:637423369471:stack/InvoiceApi-dev/9fa3c410-a04a-11f1-97a3-0e70392daf69
```

**Verification:**
```powershell
# Get your API URL from CloudFormation outputs
aws cloudformation describe-stacks --stack-name InvoiceApi-dev `
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text
```
Then test a public-style call (will get 401 because of Cognito — that's correct, not an import error):
```powershell
$apiUrl = "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1"
Invoke-WebRequest -Uri "$apiUrl/invoices" -UseBasicParsing
# Expected: 401 Unauthorized — confirms Lambda loaded correctly

```
```
$apiUrl = "https://y4ny8fyzcb.execute-api.us-east-1.amazonaws.com/v1/"
Invoke-WebRequest -Uri "$apiUrl/invoices" -UseBasicParsing
```
---

### PHASE 2 — Configure the Frontend

---

### Step 4 — Set Up Frontend Environment Variables

**What:** Create `frontend/.env.local` with the real CDK output values.

**Why:** The React app uses `import.meta.env.VITE_*` variables baked in at build time. Without them it can't reach the API or authenticate with Cognito.

**Get values from CloudFormation:**
```powershell
# API URL
aws cloudformation describe-stacks --stack-name InvoiceApi-dev `
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text

- https://y4ny8fyzcb.execute-api.us-east-1.amazonaws.com/v1/

# Cognito User Pool ID
aws cloudformation describe-stacks --stack-name InvoiceAuth-dev `
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text

- us-east-1_S11FtLB8g  

# Cognito Client ID
aws cloudformation describe-stacks --stack-name InvoiceAuth-dev `
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text
```

- 4ehstlnb88t4ujj233vsrqbok8

**Create file:** `frontend/.env.local`
```
VITE_API_URL=https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
```

```
VITE_API_URL=https://y4ny8fyzcb.execute-api.us-east-1.amazonaws.com/v1/
VITE_COGNITO_USER_POOL_ID=us-east-1_S11FtLB8g  
VITE_COGNITO_USER_POOL_CLIENT_ID=4ehstlnb88t4ujj233vsrqbok8
```

**Important:** `.env.local` is in `.gitignore` — never commit it.

**Install dependencies and run locally:**
```powershell
E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL\infrastructure

cd frontend
Get-ChildItem
npm install
npm run dev
```

Open `http://localhost:5173` — you should see the Login page.

**Verification:**
- Login page loads without console errors
- Click "Sign Up" → register with a real email
- Check your email for the Cognito verification code
- Enter the code and confirm
- You should be redirected to the Dashboard

**Common errors:**

| Error | Fix |
|-------|-----|
| `Amplify not configured` | Check `.env.local` has all 3 VITE_ variables with no trailing spaces |
| `Network Error` on login | CORS issue. Check API Gateway has CORS enabled (it does in api-stack.ts) |
| `UserPool not found` | Wrong User Pool ID — re-check CloudFormation output |

---

### Step 5 — Create a Test Cognito User (AWS Console)

**What:** Create a confirmed user so you can log into the app immediately.

**Why:** Self-signup requires an email. For quick testing create one via CLI.

**Commands:**
```powershell
$POOL_ID = "us-east-1_XXXXXXXXX"   # replace with your real pool ID

$POOL_ID = "us-east-1_S11FtLB8g" 

# Create user
aws cognito-idp admin-create-user `
  --user-pool-id $POOL_ID `
  --username "demo@example.com" `
  --temporary-password "Temp@1234!" `
  --message-action SUPPRESS

# Set permanent password (skip force-change-password)
aws cognito-idp admin-set-user-password `
  --user-pool-id $POOL_ID `
  --username "demo@example.com" `
  --password "Invoice@Demo2026!" `
  --permanent
```

**Verification:**
- Log in at `http://localhost:5173` with `demo@example.com` / `Invoice@Demo2026!`
- Dashboard should load (may show empty state, that's fine)

---

### PHASE 3 — End-to-End Pipeline Test

---

### Step 6 — Upload a Test Invoice via the Frontend

**What:** Upload one of the sample invoices through the UI to trigger the full pipeline.

**Why:** This validates every component — presigned URL, S3, SQS, Step Functions, all 4 Lambdas, DynamoDB, EventBridge.

**Steps:**
1. Log into the app at `http://localhost:5173`
2. Click "Upload Invoice" (or navigate to the Invoices page)
3. Select `invoices/invoice_1.png` from the project root
4. Watch the upload progress indicator

**While upload runs, watch logs in parallel:**
```powershell
# Watch SQS trigger Lambda
aws logs tail /aws/lambda/invoice-sqs-trigger-dev --follow

# Watch Step Functions logs
aws logs tail /aws/states/invoice-pipeline-dev --follow
```

**Verification — check DynamoDB:**
```powershell
aws dynamodb scan `
  --table-name invoices-dev `
  --query "Items[0]" `
  --output json
```
Should return a full invoice record with status=COMPLETED, risk_score, anomalies.

**Check frontend:** Refresh the Invoices page — the invoice should appear with its risk badge.

---

### Step 7 — Upload via CLI (Alternative / Scripted Testing)

**What:** Upload directly via AWS CLI, bypassing the frontend, for reproducible testing.

**Steps:**
```powershell
# Step 1: Get your real User Pool and Client IDs
$POOL_ID    = "us-east-1_XXXXXXXXX"
$CLIENT_ID  = "XXXXXXXXXXXXXXXXXXXXXXXXXX"

# Step 2: Get ID token via CLI
$AUTH = aws cognito-idp initiate-auth `
  --auth-flow USER_PASSWORD_AUTH `
  --client-id $CLIENT_ID `
  --auth-parameters "USERNAME=demo@example.com,PASSWORD=Invoice@Demo2026!" `
  | ConvertFrom-Json

$TOKEN = $AUTH.AuthenticationResult.IdToken
$API_URL = "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1"

# Step 3: Get pre-signed upload URL
$UPLOAD_RESP = Invoke-RestMethod `
  -Uri "$API_URL/invoices/upload-url" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $TOKEN"; "Content-Type" = "application/json" } `
  -Body '{"filename":"invoice_1.png","content_type":"image/png"}'

$INVOICE_ID = $UPLOAD_RESP.invoice_id
$UPLOAD_URL = $UPLOAD_RESP.upload_url

Write-Host "Invoice ID: $INVOICE_ID"

# Step 4: Upload the file directly to S3
Invoke-WebRequest `
  -Uri $UPLOAD_URL `
  -Method PUT `
  -InFile "invoices\invoice_1.png" `
  -Headers @{ "Content-Type" = "image/png" }

Write-Host "Upload complete. Pipeline should now be running..."
Start-Sleep -Seconds 15

# Step 5: Poll status
Invoke-RestMethod `
  -Uri "$API_URL/invoices/$INVOICE_ID/status" `
  -Headers @{ Authorization = "Bearer $TOKEN" }
```

**Expected output:**
```json
{
  "invoice_id": "inv_20260825_a1b2c3d4",
  "status": "COMPLETED",
  "risk_score": 15,
  "risk_level": "LOW"
}
```

---

### PHASE 4 — Infrastructure Hardening

---

### Step 8 — Deploy All Stacks (Full Redeploy After Fixes)

**What:** Deploy all stacks cleanly after the shared layer fix.

**Commands (PowerShell from `infrastructure/`):**
```powershell
# Build TypeScript first
npm run build

# Deploy in dependency order
npx cdk deploy InvoiceStorage-dev InvoiceAuth-dev `
  --context env=dev --require-approval never

npx cdk deploy InvoiceProcessing-dev InvoiceApi-dev `
  --context env=dev --require-approval never

# Optional: deploy frontend stack (only if you've run npm run build in frontend/)
# cd ..\frontend ; npm run build ; cd ..\infrastructure
npx cdk deploy InvoiceFrontend-dev `
  --context env=dev --require-approval never
```

**Verification — check all stacks are CREATE_COMPLETE:**
```powershell
aws cloudformation list-stacks `
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE `
  --query "StackSummaries[?contains(StackName,'Invoice')].StackName" `
  --output table
```

Expected output:
```
InvoiceStorage-dev
InvoiceAuth-dev
InvoiceProcessing-dev
InvoiceApi-dev
InvoiceFrontend-dev
```

---

### Step 9 — Add CloudWatch Alarms for Lambda Errors

**What:** Add error rate alarms for the 4 critical processing Lambdas.

**Why:** The DLQ alarm already exists. But Lambda errors that don't send to DLQ (e.g., permission errors, Bedrock failures) need their own alarms.

**Files to modify:** `infrastructure/lib/processing-stack.ts`

Add after the DLQ alarm definition:
```typescript
// Lambda error rate alarms
const lambdaErrorAlarm = (fn: lambda.Function, name: string) =>
  new cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
    alarmName: `${fn.functionName}-errors`,
    metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
    threshold: 3,
    evaluationPeriods: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });

lambdaErrorAlarm(ocrLambda, 'OCR');
lambdaErrorAlarm(aiLambda, 'AI');
lambdaErrorAlarm(riskLambda, 'Risk');
lambdaErrorAlarm(storeLambda, 'Store');
```

**Verification:**
```powershell
aws cloudwatch describe-alarms `
  --alarm-name-prefix "invoice-" `
  --query "MetricAlarms[*].AlarmName" --output table
```

---

### Step 10 — Set Up GitHub Actions Secrets

**What:** Configure the 6 secrets needed for the CI/CD pipelines to work.

**Why:** Without them, push to `main` will fail the deploy job.

**In GitHub: Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value | Where to Get It |
|-------------|-------|-----------------|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::637423369471:role/GitHubActionsDeployRole` | Create IAM role below |
| `VITE_API_URL` | Your API Gateway URL | CloudFormation: InvoiceApi-dev → Outputs → ApiUrl |
| `VITE_COGNITO_USER_POOL_ID` | `us-east-1_XXXXXXXX` | CloudFormation: InvoiceAuth-dev → Outputs → UserPoolId |
| `VITE_COGNITO_USER_POOL_CLIENT_ID` | client ID | CloudFormation: InvoiceAuth-dev → Outputs → UserPoolClientId |
| `FRONTEND_BUCKET` | `invoice-frontend-hosting-dev-637423369471` | CloudFormation: InvoiceFrontend-dev → Outputs |
| `CF_DISTRIBUTION_ID` | CloudFront distribution ID | CloudFormation: InvoiceFrontend-dev → Outputs → DistributionId |

**Create the OIDC IAM role for GitHub Actions:**
```powershell
# Create the OIDC provider (one-time per account)
aws iam create-open-id-connect-provider `
  --url https://token.actions.githubusercontent.com `
  --client-id-list sts.amazonaws.com `
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Create trust policy file
[System.IO.File]::WriteAllText("$env:TEMP\trust.json", '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::637423369471:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_USERNAME/YOUR_REPO_NAME:*" }
    }
  }]
}')

# Create the role
aws iam create-role `
  --role-name GitHubActionsDeployRole `
  --assume-role-policy-document file://$env:TEMP/trust.json

# Attach CDK deploy permissions (broad for dev; tighten for prod)
aws iam attach-role-policy `
  --role-name GitHubActionsDeployRole `
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

**Verification:** Push a small change to `main` and check the Actions tab — both `test` and `deploy` jobs should go green.

---

### PHASE 5 — Frontend Build and CloudFront Deploy

---

### Step 11 — Build and Deploy the Frontend

**What:** Build the React app and deploy it to CloudFront.

**Commands (PowerShell):**
```powershell
cd frontend

# Create .env.local if not done already (Step 4)
# Build the production bundle
npm run build

# Verify dist/ was created
Get-ChildItem dist/

# Back to infrastructure — deploy frontend stack
cd ..\infrastructure
npx cdk deploy InvoiceFrontend-dev --context env=dev --require-approval never
```

**Verification:**
```powershell
# Get CloudFront URL
aws cloudformation describe-stacks --stack-name InvoiceFrontend-dev `
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text
```
Open the URL in a browser. You should see the Login page over HTTPS.

---

### PHASE 6 — Testing

---

### Step 12 — Run Unit Tests

**What:** Run the existing pytest unit test suite.

**Commands (PowerShell from project root):**
```powershell
# Activate virtual env if not already active
.\.venv\Scripts\Activate.ps1

# Install test dependencies
pip install -r backend/tests/requirements-test.txt

# Run all unit tests
python -m pytest backend/tests/unit/ -v --tb=short
```

**Expected output:**
```
test_api_response.py   ....   PASSED
test_ocr_parser.py     ....   PASSED
test_prompt_builder.py ....   PASSED
test_risk_scoring.py   ....   PASSED
```

**Common errors:**

| Error | Fix |
|-------|-----|
| `ModuleNotFoundError: No module named 'shared'` | Add `PYTHONPATH=backend/lambdas` to `pytest.ini` or run: `$env:PYTHONPATH="backend/lambdas"; pytest ...` |
| `ModuleNotFoundError: No module named 'pydantic'` | Run `pip install pydantic>=2.0.0` in the venv |

---

### Step 13 — Integration Test: End-to-End Pipeline Verification

**What:** Automated script that uploads an invoice and waits for COMPLETED status.

**Create file:** `backend/tests/integration/test_e2e_pipeline.py`

```python
"""
Integration test — requires real AWS credentials and deployed dev stack.
Run: pytest backend/tests/integration/ -v -s
"""
import os
import time
import uuid
import boto3
import requests
import pytest

API_URL   = os.environ["VITE_API_URL"]
POOL_ID   = os.environ["VITE_COGNITO_USER_POOL_ID"]
CLIENT_ID = os.environ["VITE_COGNITO_USER_POOL_CLIENT_ID"]
USERNAME  = os.environ.get("TEST_USERNAME", "demo@example.com")
PASSWORD  = os.environ.get("TEST_PASSWORD", "Invoice@Demo2026!")
TEST_FILE = os.path.join(os.path.dirname(__file__), "../../../invoices/invoice_1.png")


def get_token():
    idp = boto3.client("cognito-idp", region_name="us-east-1")
    resp = idp.initiate_auth(
        AuthFlow="USER_PASSWORD_AUTH",
        ClientId=CLIENT_ID,
        AuthParameters={"USERNAME": USERNAME, "PASSWORD": PASSWORD},
    )
    return resp["AuthenticationResult"]["IdToken"]


def test_full_pipeline():
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 1. Get presigned URL
    resp = requests.post(f"{API_URL}/invoices/upload-url",
                         json={"filename": "invoice_1.png", "content_type": "image/png"},
                         headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    invoice_id = data["invoice_id"]
    upload_url = data["upload_url"]

    # 2. Upload file
    with open(TEST_FILE, "rb") as f:
        put_resp = requests.put(upload_url, data=f, headers={"Content-Type": "image/png"})
    assert put_resp.status_code == 200

    # 3. Poll for completion (max 90s)
    for _ in range(18):
        time.sleep(5)
        status_resp = requests.get(f"{API_URL}/invoices/{invoice_id}/status", headers=headers)
        status = status_resp.json().get("status")
        print(f"  Status: {status}")
        if status == "COMPLETED":
            break
        if status == "FAILED":
            pytest.fail(f"Pipeline failed: {status_resp.json()}")
    else:
        pytest.fail("Pipeline did not complete within 90 seconds")

    # 4. Fetch full invoice
    inv_resp = requests.get(f"{API_URL}/invoices/{invoice_id}", headers=headers)
    assert inv_resp.status_code == 200
    invoice = inv_resp.json()

    assert invoice["status"] == "COMPLETED"
    assert invoice["risk_score"] is not None
    assert invoice["risk_level"] in ["LOW", "MEDIUM", "HIGH"]
    print(f"\n  Risk: {invoice['risk_level']} ({invoice['risk_score']})")
    print(f"  Anomalies: {len(invoice.get('anomalies', []))}")
    print(f"  AI Summary: {invoice.get('ai_explanation', '')[:100]}")
```

**Run:**
```powershell
$env:VITE_API_URL = "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1"
$env:VITE_COGNITO_USER_POOL_ID = "us-east-1_XXXXXXXXX"
$env:VITE_COGNITO_USER_POOL_CLIENT_ID = "XXXXXXXXXXXXXXXXXXXXXXXXXX"
python -m pytest backend/tests/integration/test_e2e_pipeline.py -v -s
```

---

## 4. Production Features Reference

> These are enhancements to implement once the core pipeline works. Each is self-contained.

---

### 4.1 Frontend / Dashboard

**Current state:** 5 pages exist: Login, Dashboard, Invoices, InvoiceDetail, Analytics. Components for analytics and invoices are scaffolded.

**What to verify/complete:**
- Upload progress bar uses `useUploadStore` — confirm the `upload.ts` service calls `updateUpload()` as it streams to S3
- InvoiceDetailPage should show: extracted fields, line items table, anomaly list with severity badges, AI explanation, risk score gauge
- AnalyticsPage uses Recharts — verify the `<LineChart>` for risk trend and `<BarChart>` for vendor stats render with real data
- DashboardPage should show the 3 KPI cards (total invoices, high risk count, avg processing time) from `getAnalyticsSummary()`

**Quick check:**
```powershell
# In frontend/
npm run type-check   # must return 0 errors
npm run lint         # must return 0 warnings
```

---

### 4.2 Cognito Authentication Hardening

**Current state:** Cognito User Pool with SRP auth, email verification, strong password policy. No MFA.

**Production additions:**
- Enable MFA (TOTP) for production user pool in `auth-stack.ts`:
  ```typescript
  mfa: cognito.Mfa.OPTIONAL,
  mfaSecondFactor: { sms: false, otp: true },
  ```
- Tighten CORS in `api-stack.ts` — replace `ALL_ORIGINS` with your CloudFront domain:
  ```typescript
  allowOrigins: [`https://${distribution.distributionDomainName}`],
  ```
- Add Cognito hosted UI as a fallback for enterprise SSO (future)

---

### 4.3 API Gateway / Backend Improvements

**Current gaps:**
- Analytics lambdas do full table scans — expensive at scale. For demo this is fine, document it as a known limitation.
- No request validation at API Gateway level — add a `RequestValidator` to enforce required body fields on POST.
- API Gateway throttling — add usage plan with default 100 req/s burst, 50 req/s steady:
  ```typescript
  const plan = this.api.addUsagePlan('DefaultPlan', {
    throttle: { rateLimit: 50, burstLimit: 100 },
  });
  plan.addApiStage({ stage: this.api.deploymentStage });
  ```

---

### 4.4 AI/ML Improvements

**Current state:** Nova Micro, temperature 0.2, max 1500 tokens, structured JSON schema prompt.

**Possible improvements for interview discussion:**
- **Model upgrade path:** Nova Micro → Claude Haiku (better reasoning, costs ~10x more). Current architecture already supports this by changing `BEDROCK_MODEL_ID` env var.
- **Confidence thresholding:** If `confidence < 0.5`, flag for manual review instead of automated risk scoring.
- **Prompt versioning:** Store the prompt template in SSM Parameter Store so you can A/B test prompt changes without redeploying Lambda.
- **Batch processing:** If daily invoice volume > 1000, consider Bedrock batch inference API instead of per-invoice real-time calls.

**SSM prompt versioning (optional enhancement):**
```python
# In ai_analysis/handler.py
import boto3
ssm = boto3.client('ssm')
def get_prompt_template() -> str:
    resp = ssm.get_parameter(Name='/invoice-platform/prompt-template', WithDecryption=False)
    return resp['Parameter']['Value']
```

---

### 4.5 Monitoring and CloudWatch

**Current state:** X-Ray tracing enabled on all Lambdas and API Gateway. DLQ alarm exists. Step Functions logs to `/aws/states/invoice-pipeline-dev`.

**Add these to `processing-stack.ts` for a complete observability picture:**

```typescript
// Step Functions execution failures
new cloudwatch.Alarm(this, 'SfnFailureAlarm', {
  alarmName: `invoice-sfn-failures-${envName}`,
  metric: this.stateMachine.metricFailed({ period: cdk.Duration.minutes(5) }),
  threshold: 1,
  evaluationPeriods: 1,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
}).addAlarmAction(new cloudwatch_actions.SnsAction(alertTopic));

// OCR Lambda duration P99
new cloudwatch.Alarm(this, 'OcrDurationAlarm', {
  alarmName: `invoice-ocr-duration-p99-${envName}`,
  metric: ocrLambda.metricDuration({
    statistic: 'p99',
    period: cdk.Duration.minutes(5),
  }),
  threshold: 50000,  // 50 seconds — OCR timeout is 60s
  evaluationPeriods: 2,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
```

**CloudWatch Dashboard (AWS Console):** Create a dashboard named `InvoiceIntelligence-dev` with:
- Widget 1: Lambda invocations + errors (all 5 processing Lambdas)
- Widget 2: Step Functions executions started/failed/succeeded
- Widget 3: DLQ message count
- Widget 4: API Gateway 4xx/5xx count
- Widget 5: DynamoDB consumed capacity

---

### 4.6 Security / IAM Best Practices

**Current state:** Lambdas have table-specific grants (e.g., `invoicesTable.grantReadWriteData(storeLambda)`). Lambda execution roles are CDK-generated with least privilege.

**Things to verify and document for interview:**
- S3 bucket has `blockPublicAccess: BLOCK_ALL` ✓
- DynamoDB encryption with AWS-managed keys ✓
- S3 encryption S3-managed ✓
- API Gateway HTTPS only ✓
- Cognito tokens expire in 1 hour ✓

**Gaps to address:**
- S3 CORS `allowedOrigins: ['*']` — tighten to CloudFront domain in production:
  ```typescript
  allowedOrigins: [`https://${distribution.distributionDomainName}`],
  ```
- Add AWS WAF to API Gateway for production to block common exploits
- Enable S3 access logging for audit trail in production
- Rotate the Cognito token validity — already 1h access, 30d refresh (good)

---

### 4.7 Error Handling and Retries

**Current state:**
- OCR: retries on `Lambda.ServiceException`, catch → `HandleFailure` DynamoDB update
- AI: 4 retries with exponential backoff, non-fatal fallback to empty anomalies
- Risk: catch → HandleFailure
- Store: 3 retries with catch → HandleFailure
- SQS: DLQ after 3 receive attempts

**Gap — HandleFailure state:**
The `HandleFailure` Step Functions state uses `$.job_id` which may not exist in the error input. This caused the second error in your test run. Fix:

```typescript
// In processing-stack.ts, update HandleFailure DynamoUpdateItem key:
key: {
  job_id: tasks.DynamoAttributeValue.fromString(
    sfn.JsonPath.stringAt('$$.Execution.Input.job_id')  // use execution input, not state input
  ),
},
```

This references the original execution input which always contains `job_id`.

---

### 4.8 CI/CD Pipeline

**Current state:** 3 GitHub Actions workflows fully defined. Uses OIDC — no stored AWS keys.

**What works now:**
- `pr-checks.yml` — runs pytest, TypeScript type-check, `cdk synth` on every PR
- `backend.yml` — runs tests then deploys CDK on push to `main`
- `frontend.yml` — builds and deploys to S3 + CloudFront invalidation on push to `main`

**What's missing:**
- GitHub Secrets not yet configured (Step 10 above)
- OIDC role not yet created (Step 10 above)
- No staging → prod promotion gate

**Add a manual approval gate for prod (future):**
```yaml
# In backend.yml, after deploy:dev job:
deploy-prod:
  name: Deploy to prod
  needs: deploy
  environment: production    # environment with required reviewers
  if: github.ref == 'refs/heads/main'
  steps:
    - run: npx cdk deploy --all --context env=prod --require-approval never
```

---

### 4.9 Infrastructure as Code — CDK Patterns

**Current patterns (good, keep these):**
- 5-stack separation by concern (Storage, Auth, Processing, Api, Frontend)
- `envName` context variable drives all resource names and removal policies
- `RemovalPolicy.RETAIN` for prod, `DESTROY` for dev
- CDK Tags applied at app level
- Stack dependency graph is explicit with `addStackDependency()`
- No deprecated APIs (logRetention replaced with LogGroup, definition replaced with definitionBody)

**One refactor worth doing:** Extract the shared Lambda layer creation into a separate `SharedLayerStack` or a CDK helper function to avoid duplication between ProcessingStack and ApiStack.

---

### 4.10 Cost Optimization

**Current design is already cost-optimized:**
- Lambda ARM64 — ~20% cheaper than x86
- DynamoDB PAY_PER_REQUEST — zero cost at zero traffic
- Step Functions Express — ~$1 per million executions vs Standard's per-state cost
- Bedrock Nova Micro — cheapest available model (~$0.035 per million input tokens)
- S3 Intelligent Tiering lifecycle rule — auto-moves cold objects to cheaper tiers after 30 days
- CloudFront PRICE_CLASS_100 — US/Canada/Europe only, cheapest class

**Estimated monthly cost at 1000 invoices/month:**
| Service | Estimate |
|---------|---------|
| Textract AnalyzeExpense | $0.05/page × 1000 = $50 |
| Bedrock Nova Micro | ~$0.10 |
| Lambda (all functions) | < $1 |
| Step Functions Express | < $0.01 |
| DynamoDB | < $1 |
| S3 | < $1 |
| API Gateway | < $1 |
| CloudFront | < $1 |
| **Total** | **~$55/month** |

---

## 5. Final End-to-End Test

Run this checklist after every deployment to verify the full pipeline.

### 5.1 Pre-flight Checks

```powershell
# All stacks healthy?
aws cloudformation list-stacks `
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE `
  --query "StackSummaries[?contains(StackName,'Invoice')].StackName" --output table

# All Lambdas exist?
aws lambda list-functions `
  --query "Functions[?starts_with(FunctionName,'invoice-')].FunctionName" --output table

# DynamoDB tables exist?
aws dynamodb list-tables --query "TableNames[?starts_with(@,'invoice') || starts_with(@,'processing')]" --output table

# Step Functions state machine?
aws stepfunctions list-state-machines `
  --query "stateMachines[?contains(name,'invoice')].name" --output table
```

### 5.2 Step-by-Step E2E Verification

**Step A — Authentication:**
```powershell
$CLIENT_ID = "XXXXXXXXXXXXXXXXXXXXXXXXXX"
$AUTH = aws cognito-idp initiate-auth `
  --auth-flow USER_PASSWORD_AUTH `
  --client-id $CLIENT_ID `
  --auth-parameters "USERNAME=demo@example.com,PASSWORD=Invoice@Demo2026!" `
  | ConvertFrom-Json
$TOKEN = $AUTH.AuthenticationResult.IdToken
Write-Host "Auth OK — Token acquired"
```
✅ Expected: Token acquired, no error

**Step B — API reachable:**
```powershell
$API_URL = "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1"
$HEADERS = @{ Authorization = "Bearer $TOKEN" }
$LIST = Invoke-RestMethod -Uri "$API_URL/invoices" -Headers $HEADERS
Write-Host "API OK — Items: $($LIST.count)"
```
✅ Expected: 200 OK with `{"items":[], "count":0, "next_cursor":null}`

**Step C — Get presigned upload URL:**
```powershell
$UPLOAD = Invoke-RestMethod -Uri "$API_URL/invoices/upload-url" -Method POST `
  -Headers ($HEADERS + @{"Content-Type"="application/json"}) `
  -Body '{"filename":"invoice_1.png","content_type":"image/png"}'
$INVOICE_ID = $UPLOAD.invoice_id
Write-Host "Upload URL OK — Invoice ID: $INVOICE_ID"
```
✅ Expected: 201 with `invoice_id`, `upload_url`, `s3_key`

**Step D — Upload invoice to S3:**
```powershell
Invoke-WebRequest -Uri $UPLOAD.upload_url -Method PUT `
  -InFile "invoices\invoice_1.png" -Headers @{"Content-Type"="image/png"}
Write-Host "S3 Upload OK"
```
✅ Expected: 200 OK from S3

**Step E — S3 → SQS triggered (check CloudWatch):**
```powershell
Start-Sleep -Seconds 3
aws logs filter-log-events --log-group-name /aws/lambda/invoice-sqs-trigger-dev `
  --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-2).ToUnixTimeMilliseconds()) `
  --query "events[-1].message" --output text
```
✅ Expected: `[SQSTrigger] New upload: s3://invoice-uploads-dev-637423369471/invoices/...`

**Step F — Step Functions execution started:**
```powershell
aws logs filter-log-events --log-group-name /aws/states/invoice-pipeline-dev `
  --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-2).ToUnixTimeMilliseconds()) `
  --limit 5 --query "events[*].message" --output text
```
✅ Expected: execution started log entry (no FAILED entries)

**Step G — Poll until COMPLETED:**
```powershell
for ($i = 0; $i -lt 18; $i++) {
  Start-Sleep -Seconds 5
  $STATUS = Invoke-RestMethod -Uri "$API_URL/invoices/$INVOICE_ID/status" -Headers $HEADERS
  Write-Host "  [$i] Status: $($STATUS.status)"
  if ($STATUS.status -eq "COMPLETED" -or $STATUS.status -eq "FAILED") { break }
}
```
✅ Expected: COMPLETED within 30–60 seconds

**Step H — Verify DynamoDB record:**
```powershell
$INVOICE = Invoke-RestMethod -Uri "$API_URL/invoices/$INVOICE_ID" -Headers $HEADERS
Write-Host "Vendor   : $($INVOICE.vendor_name)"
Write-Host "Total    : $($INVOICE.total_amount)"
Write-Host "Risk     : $($INVOICE.risk_level) ($($INVOICE.risk_score))"
Write-Host "Anomalies: $($INVOICE.anomalies.Count)"
Write-Host "AI Summary: $($INVOICE.ai_explanation)"
```
✅ Expected: All fields populated, risk_level in [LOW, MEDIUM, HIGH]

**Step I — Analytics working:**
```powershell
$SUMMARY = Invoke-RestMethod -Uri "$API_URL/analytics/summary" -Headers $HEADERS
Write-Host "Total Invoices  : $($SUMMARY.total_invoices)"
Write-Host "High Risk Count : $($SUMMARY.high_risk_count)"
Write-Host "Avg Risk Score  : $($SUMMARY.average_risk_score)"
```
✅ Expected: counts match what was uploaded

**Step J — Frontend verification:**
- Open CloudFront URL in browser
- Log in as `demo@example.com`
- Navigate to Invoices — uploaded invoice appears with risk badge
- Click invoice — detail page shows fields, anomalies, AI explanation
- Navigate to Analytics — charts render with data
- Navigate to Dashboard — KPI cards show non-zero values

---

### 5.3 Cleanup After Test

```powershell
# Delete test invoice
Invoke-RestMethod -Uri "$API_URL/invoices/$INVOICE_ID" -Method DELETE -Headers $HEADERS
Write-Host "Test invoice deleted"
```

---

## 6. Interview Preparation

### 6.1 Architecture Narrative (2-minute pitch)

> "I built a serverless AI Invoice Intelligence Platform on AWS. The core idea: a user uploads an invoice image, and within 30 seconds they get back a structured record with every field extracted, anomalies detected by an LLM, and a risk score — all without any running infrastructure when it's idle.
>
> The data flow is: a React frontend gets a pre-signed S3 URL from API Gateway, uploads directly to S3, which triggers SQS, which feeds a Step Functions Express workflow that runs Textract for OCR, Bedrock for AI anomaly detection, deterministic rule scoring, and finally writes to DynamoDB. The frontend polls the status endpoint and renders the result.
>
> The stack is 5 CDK stacks: Storage, Auth, Processing, API, and Frontend — each with a clear boundary. CI/CD runs on GitHub Actions with OIDC for keyless AWS auth."

---

### 6.2 Key AWS Concepts to Be Ready to Explain

| Topic | What to Say |
|-------|-------------|
| **Step Functions Express vs Standard** | Express: high-volume, short-duration, cheaper, logs to CloudWatch. Standard: long-duration (up to 1 year), supports `GetExecutionHistory`, more durable. I used Express because invoice processing is fast (<5 min) and high volume. |
| **SQS as pipeline buffer** | S3 events can't directly invoke Step Functions. SQS decouples S3 from Step Functions and adds retry (visibilityTimeout) and DLQ for poison pills. |
| **DynamoDB tenant isolation** | `tenant_id` is the partition key. Every query includes `KeyConditionExpression: tenant_id = :tid`. A tenant can only ever see their own data. Cognito sub claim is used as tenant_id — no separate user management table. |
| **Bedrock Nova Micro** | It's a first-party Amazon model. I chose it because it's fast, cheap (~$0.035/1M input tokens), and good at following structured JSON schema instructions. The prompt instructs it to return only valid JSON — no markdown wrapping — so the response is machine-parseable. |
| **Textract AnalyzeExpense** | Purpose-built for invoices/receipts. Returns named fields (VENDOR, TOTAL, LINE_ITEMS) without any training. Much better than generic `DetectDocumentText` for this use case. |
| **Lambda Layers** | A layer is a zip containing shared code deployed separately and mounted at `/opt` in the function container. Python layers must have a `python/` subdirectory — the runtime adds `/opt/python` to `sys.path` automatically. |
| **CDK multi-stack pattern** | Breaking into stacks by lifecycle: Storage/Auth stacks are stable, ProcessingStack changes frequently. Smaller stacks deploy faster, rollback blast radius is smaller. |
| **OIDC vs access keys in CI/CD** | OIDC creates short-lived tokens scoped to a specific GitHub Actions workflow run. No long-lived credentials stored anywhere. GitHub exchanges a JWT with AWS STS for a role session token — much safer than IAM user access keys in secrets. |
| **EventBridge for extensibility** | After processing, `store_results` fires an `InvoiceProcessed` event to EventBridge. Any downstream service (SNS alert, Slack webhook, audit log) can subscribe without changing the Lambda code. This is the event-driven / pub-sub pattern. |
| **ARM64 Lambdas** | Graviton2 processors are ~20% cheaper per GB-second than x86 and often faster for Python workloads. Drop-in replacement — no code changes needed since Python is cross-platform. |

---

### 6.3 Anticipated Interview Questions and Answers

**Q: How does multi-tenancy work in this system?**
A: Cognito issues a JWT with a `sub` (subject) claim that is a unique user UUID. The API Gateway Cognito authorizer validates the token and passes the claims to Lambda via `event.requestContext.authorizer.claims`. Every Lambda calls `get_tenant_id(event)` which extracts `sub`. This becomes the DynamoDB partition key, so data is physically separated by partition. No user can access another user's data without a valid token for that account.

**Q: What happens if Bedrock is throttled?**
A: The `ai_analysis` Lambda has 4 retries with exponential backoff and jitter. If all retries fail, it catches the exception and returns an empty `anomalies: []` with a note in `summary`. The pipeline continues — the invoice still gets OCR data, deterministic risk scoring, and is stored. The AI explanation will just say "Analysis unavailable." The risk score will still reflect deterministic rules. This is intentional — AI is an enhancement, not a hard dependency.

**Q: How do you handle the case where an invoice fails OCR?**
A: The OCR Lambda wraps Textract in a try/catch. On error, it calls `update_job_status(job_id, "FAILED", "OCR", error_msg)` and re-raises. The Step Functions catch block on `ocrTask` routes to `HandleFailure` which updates the DynamoDB jobs table. The frontend's status poll will get `status: FAILED` with the error message. The SQS DLQ holds the original message for 14 days for debugging.

**Q: How would you scale this to 100,000 invoices/day?**
A: SQS handles the burst — messages queue up and the SQS trigger Lambda consumes at its own pace. Step Functions Express supports 100,000 executions/second. Textract has a default quota of 100 pages/second — file a service quota increase. Bedrock has per-model quotas — use a dedicated capacity commitment for production. DynamoDB is already PAY_PER_REQUEST so it auto-scales. The only change needed is Textract quota increase and possibly splitting into two SQS queues for priority (normal vs. high-value invoices).

**Q: Why did you use Pydantic models?**
A: Pydantic provides runtime type validation on the data coming out of Textract and Bedrock, which produce raw dicts. Without validation, a null `total_amount` or an unexpected field type from Textract could silently propagate wrong data into DynamoDB. Pydantic's models also serve as living documentation of the data contract between pipeline stages.

**Q: How would you add a new anomaly detection rule?**
A: Add a function to `risk_scoring/rules.py` following the existing pattern (takes invoice_data dict, returns bool/str), call it in `handler.py`, adjust the score weight. No other Lambda needs to change. For an AI-only rule, update the prompt in `prompt_builder.py` and add the new `AnomalyType` enum value to `shared/models.py`. Deploy only the affected Lambda package.

---

### 6.4 Architecture Diagram Talking Points

When drawing the architecture on a whiteboard, use this sequence:
1. Draw the user → CloudFront → React SPA
2. Draw the upload flow: SPA → API Gateway → Lambda → presigned URL → S3 (direct upload, no API Gateway in the path)
3. Draw the async pipeline: S3 → SQS → Lambda → Step Functions → [OCR, AI, Risk, Store] → DynamoDB
4. Draw the read path: SPA polls API → API Lambda → DynamoDB → JSON response
5. Draw the alert path: DynamoDB → EventBridge → SNS → email
6. Mention: Cognito sits across Auth and API; CloudWatch/X-Ray sits across all Lambdas

---

### 6.5 What Makes This Interview-Ready

| Feature | Level |
|---------|-------|
| Serverless-first architecture | ✅ Production pattern |
| Event-driven pipeline (S3→SQS→SFN) | ✅ AWS well-architected |
| Multi-tenant data isolation | ✅ Enterprise pattern |
| AI/LLM + deterministic rules hybrid | ✅ MLOps-aware |
| Structured LLM output (JSON schema prompt) | ✅ Production AI pattern |
| Infrastructure as Code (CDK multi-stack) | ✅ DevOps best practice |
| CI/CD with OIDC (no stored credentials) | ✅ Security best practice |
| Retry + DLQ + catch all layers | ✅ Fault-tolerant design |
| X-Ray distributed tracing | ✅ Observability |
| ARM64 Lambdas + cost analysis | ✅ Shows cost awareness |
| Pydantic data contracts | ✅ Data quality awareness |
| Real unit tests | ✅ Engineering discipline |

---

*Last updated: August 2026 | Account: 637423369471 | Region: us-east-1 | Env: dev*
