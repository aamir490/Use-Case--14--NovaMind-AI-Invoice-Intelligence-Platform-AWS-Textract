# AI Invoice Intelligence Platform — Complete Deployment Guide

> Follow this guide top to bottom to deploy the project from scratch on a new machine or AWS account.
> Every step has a verification check. Do not skip steps — each one depends on the previous.

---

## Table of Contents

1. [What You Are Deploying](#1-what-you-are-deploying)
2. [Prerequisites](#2-prerequisites)
3. [Clone and Install](#3-clone-and-install)
4. [AWS Account Setup](#4-aws-account-setup)
5. [Build the Lambda Layer](#5-build-the-lambda-layer)
6. [Deploy Infrastructure (CDK)](#6-deploy-infrastructure-cdk)
7. [Attach Lambda Layers](#7-attach-lambda-layers)
8. [Configure and Build the Frontend](#8-configure-and-build-the-frontend)
9. [Deploy the Frontend Stack](#9-deploy-the-frontend-stack)
10. [Create a Test User](#10-create-a-test-user)
11. [End-to-End Smoke Test](#11-end-to-end-smoke-test)
12. [Teardown](#12-teardown)
13. [Troubleshooting Reference](#13-troubleshooting-reference)

---

## 1. What You Are Deploying

A fully serverless AI invoice processing platform on AWS:

```
Browser (React SPA)
    │
    ├── Cognito (auth)
    ├── API Gateway → Lambda → DynamoDB
    └── S3 presigned upload
            │
            └── S3 → SQS → Lambda → Step Functions
                                        ├── Textract (OCR)
                                        ├── Bedrock Nova Micro (AI anomaly detection)
                                        ├── Risk Scoring (rules engine)
                                        └── DynamoDB (store results)
```

**5 CDK stacks deployed in order:**

| Order | Stack Name | What It Creates |
|-------|-----------|----------------|
| 1 | `InvoiceStorage-dev` | S3 (3 buckets), DynamoDB (2 tables), SQS + DLQ |
| 2 | `InvoiceAuth-dev` | Cognito User Pool + Web Client |
| 3 | `InvoiceProcessing-dev` | Step Functions + 5 processing Lambdas + EventBridge + SNS |
| 4 | `InvoiceApi-dev` | API Gateway REST + 3 API Lambdas + Cognito authorizer |
| 5 | `InvoiceFrontend-dev` | CloudFront + S3 static hosting + React SPA |

---

## 2. Prerequisites

Install all of these before starting.

### 2.1 Required Tools

| Tool | Required Version | Install Command |
|------|-----------------|-----------------|
| Node.js | 20.x | https://nodejs.org — download LTS |
| Python | 3.12.x | https://python.org/downloads |
| AWS CLI | v2 | https://aws.amazon.com/cli/ |
| Git | any | https://git-scm.com |

Verify installations:
```powershell
node --version        # must show v20.x.x
python --version      # must show 3.12.x
aws --version         # must show aws-cli/2.x.x
```

### 2.2 AWS Account Requirements

You need an AWS account with permissions to create:
- IAM roles and policies
- Lambda functions and layers
- S3 buckets
- DynamoDB tables
- API Gateway
- Cognito User Pools
- Step Functions
- CloudFront distributions
- SQS queues
- EventBridge rules
- SNS topics
- CloudWatch log groups

**Recommended:** Use an IAM user or role with `AdministratorAccess` for the initial deploy.

### 2.3 AWS CLI Configuration

```powershell
aws configure
# AWS Access Key ID:     <your key>
# AWS Secret Access Key: <your secret>
# Default region:        us-east-1
# Default output format: json
```

Verify:
```powershell
aws sts get-caller-identity
# Should return your Account ID, UserId, Arn
```

### 2.4 Enable Bedrock Model Access

The AI analysis step uses **Amazon Nova Micro**. You must enable it in the AWS Console before deploying.

1. Open AWS Console → **Amazon Bedrock** → **Model access** (left sidebar)
2. Click **Manage model access**
3. Find **Amazon Nova Micro** (`us.amazon.nova-micro-v1:0`)
4. Check the box → **Save changes**
5. Wait until status shows **Access granted** (usually instant)

> **Without this step the AI analysis Lambda will fail** with `AccessDeniedException`.

---

## 3. Clone and Install

```powershell
# Clone the repository
git clone <YOUR_REPO_URL>
cd Trigger_OCR_Function_FM_NoSQL

# Install CDK infrastructure dependencies
cd infrastructure
npm ci
cd ..

# Install frontend dependencies
cd frontend
npm ci
cd ..
```

**Verify:**
```powershell
# Check CDK is available
cd infrastructure
npx cdk --version   # should show 2.x.x
cd ..
```

---

## 4. AWS Account Setup

### 4.1 CDK Bootstrap (one-time per account/region)

CDK needs an S3 bucket and IAM roles in your account before it can deploy anything.

```powershell
cd infrastructure

# Replace with your actual account ID
$ACCOUNT_ID = aws sts get-caller-identity --query Account --output text
$REGION = "us-east-1"

npx cdk bootstrap aws://$ACCOUNT_ID/$REGION
```

**Expected output:** `Environment aws://XXXXXXXXXXXX/us-east-1 bootstrapped.`

**Verify:**
```powershell
aws cloudformation describe-stacks --stack-name CDKToolkit --query "Stacks[0].StackStatus" --output text
# Should return: CREATE_COMPLETE or UPDATE_COMPLETE
```

### 4.2 Update the ALLOWED_ORIGINS (optional, for local dev)

The API already allows `http://localhost:5173` by default. If your frontend runs on a different port, update this constant in `infrastructure/lib/api-stack.ts`:

```typescript
const ALLOWED_ORIGINS = [
  'http://localhost:5173',   // Vite dev server
  'http://localhost:4173',   // Vite preview
  // 'https://YOUR_CLOUDFRONT_URL' — added in step 9
];
```

---

## 5. Build the Lambda Layer

All 8 Lambda functions import from a shared Python package (`shared/`). The package must be packaged as a Lambda Layer with the correct directory structure before deploying.

This step builds `backend/lambdas/shared-layer-v2/` — the staging directory that CDK zips and uploads.

```powershell
# From the project root
$root = (Get-Location).Path
$srcPy  = "$root\backend\lambdas\shared"
$outDir = "$root\backend\lambdas\shared-layer-v2\python\shared"

# Create the package directory
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# Copy the shared Python source files
Copy-Item "$srcPy\*.py" $outDir -Force
Write-Host "Copied source files"

# Install Python dependencies flat into python/ (NOT into python/shared/)
# This makes pydantic, boto3 etc importable directly
pip install pydantic>=2.0.0 boto3>=1.34.0 `
    -t "$root\backend\lambdas\shared-layer-v2\python" --quiet --upgrade
Write-Host "pip install done"
```

**Verify the structure:**
```powershell
$layerPy = "$root\backend\lambdas\shared-layer-v2\python"
Write-Host "shared\db.py     : $(Test-Path "$layerPy\shared\db.py")"
Write-Host "shared\models.py : $(Test-Path "$layerPy\shared\models.py")"
Write-Host "pydantic\        : $(Test-Path "$layerPy\pydantic")"
Write-Host "boto3\           : $(Test-Path "$layerPy\boto3")"
```

All four should print `True`.

> **Why this structure?** Lambda adds `/opt/python` to `sys.path`. The handlers import `from shared.db import ...` — so `shared` must be a package at `/opt/python/shared/`. That means the zip must contain `python/shared/db.py`, `python/shared/models.py`, etc. The dependencies (pydantic, boto3) sit flat in `python/` so they are importable directly.

---

## 6. Deploy Infrastructure (CDK)

Deploy the stacks in dependency order. Stacks 1 and 2 have no dependencies on each other so they can be deployed together.

### 6.1 Compile TypeScript

```powershell
cd infrastructure
npm run build
```

Must complete with no errors.

### 6.2 Deploy Storage + Auth

```powershell
npx cdk deploy InvoiceStorage-dev InvoiceAuth-dev `
    --context env=dev --require-approval never
```

**Expected:** Both stacks reach `CREATE_COMPLETE`. Takes ~3 minutes.

**Verify:**
```powershell
aws cloudformation describe-stacks --stack-name InvoiceStorage-dev `
    --query "Stacks[0].StackStatus" --output text
# CREATE_COMPLETE

aws cloudformation describe-stacks --stack-name InvoiceAuth-dev `
    --query "Stacks[0].StackStatus" --output text
# CREATE_COMPLETE
```

**Save the Cognito outputs** — you need them in step 8:
```powershell
aws cloudformation describe-stacks --stack-name InvoiceAuth-dev `
    --query "Stacks[0].Outputs" --output table
# Note UserPoolId and UserPoolClientId
```

### 6.3 Deploy Processing + API

```powershell
npx cdk deploy InvoiceProcessing-dev InvoiceApi-dev `
    --context env=dev --require-approval never
```

**Expected:** Both stacks reach `CREATE_COMPLETE`. Takes ~5 minutes.

**Save the API URL:**
```powershell
aws cloudformation describe-stacks --stack-name InvoiceApi-dev `
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text
# e.g. https://y4ny8fyzcb.execute-api.us-east-1.amazonaws.com/v1/
```

**Verify:**
```powershell
aws cloudformation list-stacks `
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE `
    --query "StackSummaries[?contains(StackName,'Invoice')].StackName" `
    --output table
```
Should show all 4 deployed stacks.

---

## 7. Attach Lambda Layers

> **Why is this a separate step?** CDK publishes the Lambda layer as part of the stack deployment, but on Windows the CDK asset bundling sometimes produces a layer zip with the wrong directory structure. This step publishes a correctly-structured layer directly via AWS CLI and attaches it to all functions. This is the most reliable approach on Windows.

> **On Linux/Mac** with Docker installed, `cdk deploy` may handle this automatically. Skip to step 8 and only come back here if you see `No module named 'shared'` errors.

### 7.1 Run the Layer Fix Script

This script builds the zip, publishes the layer, and attaches it to all 8 Lambda functions.

```powershell
cd <project-root>
powershell -ExecutionPolicy Bypass -File fix-layer.ps1
```

**Expected output:**
```
Building layer structure...
  Copied .py files to python\shared\
  pip install done
Structure check:
  python\shared\db.py       : True
  python\shared\models.py   : True
  python\shared\__init__.py : True
  python\pydantic\          : True
Creating zip...
  Size: ~20 MB
Publishing layer...
  New ARN: arn:aws:lambda:us-east-1:XXXX:layer:invoice-api-shared-dev:X
Updating Lambda functions...
  invoice-api-upload-dev updated
  invoice-api-invoices-dev updated
  invoice-api-analytics-dev updated
Smoke testing upload Lambda...
Response: {"statusCode": 201, ...}
```

The response must show `"statusCode": 201` — that confirms the upload Lambda can import `shared` and reach DynamoDB.

### 7.2 Run the Processing Layer Fix Script

```powershell
powershell -ExecutionPolicy Bypass -File fix-processing-layer.ps1
```

**Expected output:**
```
Publishing layer for processing stack...
  New ARN: arn:aws:lambda:us-east-1:XXXX:layer:invoice-shared-dev:X
Updating processing Lambdas...
  invoice-ocr-dev updated
  invoice-ai-analysis-dev updated
  invoice-risk-scoring-dev updated
  invoice-store-results-dev updated
  invoice-sqs-trigger-dev updated
All processing Lambdas updated.
```

### 7.3 Verify Layers are Attached

```powershell
aws lambda get-function-configuration `
    --function-name invoice-api-upload-dev `
    --query "Layers[*].Arn" --output text

aws lambda get-function-configuration `
    --function-name invoice-ocr-dev `
    --query "Layers[*].Arn" --output text
```

Both should return a layer ARN. If either is empty, re-run the corresponding fix script.

---

## 8. Configure and Build the Frontend

### 8.1 Create the Environment File

The React app needs 3 values from your CDK deployment. These are baked into the build at compile time.

```powershell
# Get the values from CloudFormation
$API_URL = aws cloudformation describe-stacks --stack-name InvoiceApi-dev `
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text

$POOL_ID = aws cloudformation describe-stacks --stack-name InvoiceAuth-dev `
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text

$CLIENT_ID = aws cloudformation describe-stacks --stack-name InvoiceAuth-dev `
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text

Write-Host "API_URL   : $API_URL"
Write-Host "POOL_ID   : $POOL_ID"
Write-Host "CLIENT_ID : $CLIENT_ID"
```

Create `frontend/.env.local` with these values (no trailing slash on the URL):

```
VITE_API_URL=https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
```

> `.env.local` is in `.gitignore` — never commit it.

### 8.2 Run Locally First (verify before building)

```powershell
cd frontend
npm run dev
```

Open `http://localhost:5173` — the Login page should load without console errors.

**Verify Amplify is configured:** Open DevTools → Console. There should be no `Amplify not configured` or `UserPool not found` errors.

### 8.3 Build for Production

```powershell
cd frontend
npm run build
```

Must complete with no TypeScript errors. The `dist/` folder is created.

**Verify:**
```powershell
Test-Path "frontend\dist\index.html"   # must return True
```

---

## 9. Deploy the Frontend Stack

```powershell
cd infrastructure
npx cdk deploy InvoiceFrontend-dev `
    --context env=dev --require-approval never
```

**Get your CloudFront URL:**
```powershell
aws cloudformation describe-stacks --stack-name InvoiceFrontend-dev `
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text
# e.g. https://XXXXXXXXXXXX.cloudfront.net
```

### 9.1 Add CloudFront URL to CORS

Edit `infrastructure/lib/api-stack.ts` and add your CloudFront URL:

```typescript
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://XXXXXXXXXXXX.cloudfront.net',   // <-- add this
];
```

Redeploy the API stack:
```powershell
npm run build
npx cdk deploy InvoiceApi-dev --context env=dev --require-approval never
```

**Verify:**
```powershell
Invoke-WebRequest -Uri "https://XXXXXXXXXXXX.cloudfront.net" -UseBasicParsing | Select-Object StatusCode
# 200
```

---

## 10. Create a Test User

Create a confirmed Cognito user so you can log in immediately.

```powershell
$POOL_ID = aws cloudformation describe-stacks --stack-name InvoiceAuth-dev `
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text

# Create the user (suppresses the email so no verification needed)
aws cognito-idp admin-create-user `
    --user-pool-id $POOL_ID `
    --username "demo@example.com" `
    --temporary-password "Temp@1234!" `
    --message-action SUPPRESS

# Set a permanent password (bypasses force-change-password)
aws cognito-idp admin-set-user-password `
    --user-pool-id $POOL_ID `
    --username "demo@example.com" `
    --password "Invoice@Demo2026!" `
    --permanent

Write-Host "User created: demo@example.com / Invoice@Demo2026!"
```

**Verify:**
```powershell
aws cognito-idp admin-get-user `
    --user-pool-id $POOL_ID `
    --username "demo@example.com" `
    --query "UserStatus" --output text
# CONFIRMED
```

---

## 11. End-to-End Smoke Test

Run through these checks in order to confirm every component is working.

### Check A — Login

1. Open `http://localhost:5173` (local) or your CloudFront URL
2. Sign in with `demo@example.com` / `Invoice@Demo2026!`
3. Dashboard should load

### Check B — Upload an Invoice

1. Navigate to **Invoices** → click **Upload Invoice**
2. Select any file from the `invoices/` folder in the project root (`invoice_1.png` etc.)
3. You should see a progress bar, then be redirected to the invoice detail page
4. The detail page should show **Completed** status within ~30 seconds

### Check C — Verify Pipeline via CLI

```powershell
$POOL_ID   = "us-east-1_XXXXXXXXX"    # your real pool ID
$CLIENT_ID = "XXXXXXXXXXXXXXXXXXXXXXXXXX"  # your real client ID
$API_URL   = "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1"

# Get auth token
$AUTH = aws cognito-idp initiate-auth `
    --auth-flow USER_PASSWORD_AUTH `
    --client-id $CLIENT_ID `
    --auth-parameters "USERNAME=demo@example.com,PASSWORD=Invoice@Demo2026!" `
    | ConvertFrom-Json
$TOKEN = $AUTH.AuthenticationResult.IdToken

# List invoices
$RESULT = Invoke-RestMethod -Uri "$API_URL/invoices" `
    -Headers @{ Authorization = "Bearer $TOKEN" }
Write-Host "Invoice count: $($RESULT.count)"

# Get analytics summary
$SUMMARY = Invoke-RestMethod -Uri "$API_URL/analytics/summary" `
    -Headers @{ Authorization = "Bearer $TOKEN" }
Write-Host "Total invoices : $($SUMMARY.total_invoices)"
Write-Host "High risk count: $($SUMMARY.high_risk_count)"
```

### Check D — Verify DynamoDB has data

```powershell
aws dynamodb scan --table-name invoices-dev `
    --query "Count" --output text
# Should be > 0
```

### Check E — Check for errors in Step Functions logs

```powershell
aws logs filter-log-events `
    --log-group-name /aws/states/invoice-pipeline-dev `
    --start-time ([DateTimeOffset]::UtcNow.AddMinutes(-30).ToUnixTimeMilliseconds()) `
    --query "events[?contains(message,'FAILED') || contains(message,'error')].message" `
    --output text
# Should be empty (no failures)
```

---

## 12. Teardown

To destroy all AWS resources and stop incurring costs:

```powershell
cd infrastructure

# Destroy all stacks (in reverse dependency order)
npx cdk destroy --all --context env=dev --force
```

> **Warning:** This permanently deletes all S3 buckets (and their contents), DynamoDB tables, Cognito user pool, and all other resources. In dev environment `RemovalPolicy.DESTROY` is set so buckets are emptied automatically. This is irreversible.

**Verify cleanup:**
```powershell
aws cloudformation list-stacks `
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE `
    --query "StackSummaries[?contains(StackName,'Invoice')].StackName" `
    --output table
# Should return empty table
```

---

## 13. Troubleshooting Reference

### `No module named 'shared'` (Lambda 502 error)

The Lambda layer has the wrong directory structure or is not attached.

```powershell
# Re-run both fix scripts from the project root
powershell -ExecutionPolicy Bypass -File fix-layer.ps1
powershell -ExecutionPolicy Bypass -File fix-processing-layer.ps1
```

Then try again. The smoke test at the end of `fix-layer.ps1` must show `statusCode: 201`.

---

### `No 'Access-Control-Allow-Origin' header` (browser CORS error)

The API Gateway CORS configuration is not allowing your origin.

1. Check `infrastructure/lib/api-stack.ts` — the `ALLOWED_ORIGINS` array must include your exact frontend URL (no trailing slash)
2. Redeploy: `npx cdk deploy InvoiceApi-dev --context env=dev --require-approval never`
3. Test preflight:
```powershell
$API = "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1"
Invoke-WebRequest -Uri "$API/invoices" -Method OPTIONS `
    -Headers @{ "Origin" = "http://localhost:5173"; "Access-Control-Request-Method" = "GET" } `
    -UseBasicParsing | Select-Object StatusCode, Headers
# Must return 204 with Access-Control-Allow-Origin header
```

---

### `StateMachineTypeNotSupported` when calling `list-executions`

The state machine is **Express** type, not Standard. Express workflows do not support `list-executions`.

Check logs instead:
```powershell
aws logs filter-log-events `
    --log-group-name /aws/states/invoice-pipeline-dev `
    --limit 10 --query "events[*].message" --output text
```

---

### `UserAlreadyAuthenticatedException` on login

Amplify already has an active session. Either:
- Refresh the page — `App.tsx` restores the session and redirects to the dashboard
- Or clear local storage in DevTools → Application → Local Storage → Clear All

---

### `InvalidExecutionInput` when starting Step Functions manually via CLI

PowerShell mangling JSON. Use a file instead:
```powershell
[System.IO.File]::WriteAllText(
    "$env:TEMP\sfn-input.json",
    '{"bucket":"invoice-uploads-dev-ACCOUNTID","key":"invoices/test-user/invoice_1.png"}'
)
aws stepfunctions start-execution `
    --state-machine-arn arn:aws:states:us-east-1:ACCOUNTID:stateMachine:invoice-processing-pipeline-dev `
    --input file://$env:TEMP/sfn-input.json
```

---

### Preflight shows correct headers but requests still fail

The request is being blocked before it's sent ("Provisional headers are shown" in DevTools). This is a browser extension or cached preflight issue. Try:
1. Open an **Incognito window** (`Ctrl+Shift+N`) and retry
2. Check DevTools Network tab → tick **Disable cache** → hard reload (`Ctrl+Shift+R`)
3. Disable browser extensions (especially ad blockers or CORS helpers)

---

### CDK deploy fails with `ExportNameAlreadyExists`

A previous deploy left exports behind. Either:
- Delete the old stacks first with `cdk destroy --all`
- Or change the `envName` context: `--context env=dev2`

---

### Bedrock `AccessDeniedException`

Model access was not enabled. Go to AWS Console → Amazon Bedrock → Model access → enable **Amazon Nova Micro** → Save. No redeploy needed.

---

### `cdk` command not found

CDK is installed as a local dev dependency, not globally. Always use `npx cdk` from the `infrastructure/` directory.

---

## Quick Reference — Key Values

After deploying, fill in these values for your deployment:

| Value | Where to Find | Example |
|-------|--------------|---------|
| API URL | CloudFormation: InvoiceApi-dev → ApiUrl | `https://y4ny8fyzcb.execute-api.us-east-1.amazonaws.com/v1` |
| Cognito User Pool ID | CloudFormation: InvoiceAuth-dev → UserPoolId | `us-east-1_S11FtLB8g` |
| Cognito Client ID | CloudFormation: InvoiceAuth-dev → UserPoolClientId | `4ehstlnb88t4ujj233vsrqbok8` |
| CloudFront URL | CloudFormation: InvoiceFrontend-dev → CloudFrontUrl | `https://XXXX.cloudfront.net` |
| Uploads Bucket | CloudFormation: InvoiceStorage-dev → UploadsBucketName | `invoice-uploads-dev-637423369471` |
| DynamoDB Table | CloudFormation: InvoiceStorage-dev → InvoicesTableName | `invoices-dev` |
| State Machine ARN | CloudFormation: InvoiceProcessing-dev → StateMachineArn | `arn:aws:states:...` |

Get all outputs at once:
```powershell
$stacks = "InvoiceStorage-dev","InvoiceAuth-dev","InvoiceProcessing-dev","InvoiceApi-dev","InvoiceFrontend-dev"
foreach ($s in $stacks) {
    Write-Host "=== $s ===" -ForegroundColor Cyan
    aws cloudformation describe-stacks --stack-name $s `
        --query "Stacks[0].Outputs[*].{Key:OutputKey,Value:OutputValue}" --output table
}
```
