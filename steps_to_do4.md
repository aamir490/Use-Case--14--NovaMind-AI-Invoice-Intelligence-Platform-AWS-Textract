# Invoice Intelligence Platform — Implementation Steps
> Simple, ordered, actionable. Do one step. Verify it works. Move to the next.

---

## Before You Start

You need:
- AWS account + AWS CLI configured (`aws configure`)
- Node.js 20+ (`node --version`)
- Python 3.12+ (`python --version`)
- Git

Check your AWS identity works:
```bash
aws sts get-caller-identity
```
You should see your account ID and user/role ARN.

---

## PHASE 0 — Set up Python virtual environment

**Goal:** Isolate all Python dependencies from your system Python.
Do this once. Always activate the venv before running any Python command.


```
dir

(.venv) PS E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL>
```


**Step 0.1 — Create the virtual environment:**
```bash
# From the project root
python -m venv .venv
```

This creates a `.venv/` folder in the project root. It is already in `.gitignore` so it will never be committed.

**Step 0.2 — Activate the virtual environment:**

On Windows (PowerShell):
```powershell
.venv\Scripts\Activate.ps1
```

On Windows (Command Prompt):
```cmd
.venv\Scripts\activate.bat
```

On Mac / Linux:
```bash
source .venv/bin/activate
```

Your prompt will change to show `(.venv)` at the start — that means it is active.


**Step 0.3 — Install test dependencies:**
```bash
pip install -r backend/tests/requirements-test.txt
```

**Step 0.4 — Verify the install:**
```bash
pip list
# You should see: pytest, moto, boto3, pydantic in the list
```

**Step 0.5 — Verify the project structure and run unit tests:**

```
Check these folders exist:
  backend/lambdas/ocr/
  backend/lambdas/ai_analysis/
  backend/lambdas/risk_scoring/
  backend/lambdas/store_results/
  backend/lambdas/sqs_trigger/
  backend/lambdas/api/
  backend/lambdas/shared/
  backend/step-functions/
  backend/tests/unit/
  infrastructure/lib/
  frontend/src/
  .github/workflows/
```

```bash
python.exe -m pip install --upgrade pip

pytest backend/tests/unit/ -v
```

Expected: all tests green. No AWS credentials needed.

---

> **Every time you open a new terminal** you must re-activate the venv:
> ```powershell
> .venv\Scripts\Activate.ps1   # Windows PowerShell
> ```
> You can tell it is active when you see `(.venv)` in your prompt.

> **If you get "module could not be loaded" error on Activate.ps1:**
> PowerShell's execution policy is blocking the script. Fix it once:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```
> Then activate again:
> ```powershell
> .venv\Scripts\Activate.ps1
> ```
> This is a one-time fix per Windows user account.

---

## PHASE 1 — Install CDK dependencies and verify synth

**Goal:** Install CDK packages, fix any version issues, verify the TypeScript compiles, then bootstrap your AWS account.

---

### Step 1.1 — Install CDK npm packages

```powershell
cd infrastructure
npm install
```

Expected: `added X packages, found 0 vulnerabilities`

If you see vulnerabilities, run:
```powershell
npm audit fix
```
Do NOT run `npm audit fix --force` — it can break things.

---

### Step 1.2 — Check CDK and library versions match

The CDK CLI (`aws-cdk`) and CDK library (`aws-cdk-lib`) now use **separate version numbers** (they diverged at CDK 2.179.0).

Check what the latest versions are:
```powershell
npm show aws-cdk-lib version    # e.g. 2.266.0
npm show aws-cdk version        # e.g. 2.1138.0
```

The `infrastructure/package.json` should already have the correct versions:
```json
"aws-cdk": "2.1138.0",
"aws-cdk-lib": "2.266.0"
```

If your output shows different latest versions, update `package.json` to match, then re-run `npm install`.

---

### Step 1.3 — Verify CDK synth (TypeScript compiles cleanly)

```powershell
npx cdk synth --context env=dev --quiet
```

Expected output (last lines):
```
Successfully synthesized to infrastructure/cdk.out
Supply a stack id (InvoiceStorage-dev, InvoiceAuth-dev, ...) to display its template.
```

You will also see some `[WARNING]` lines and "67 feature flags" notice — these are **informational only**, not errors. Ignore them.

If synth succeeds, you're ready to deploy. If you see a `TSError` or `DependencyCycle` error, see the **CDK Issues We Fixed** section at the bottom of this file.

---

### Step 1.4 — Bootstrap CDK (one time only per AWS account/region)

```powershell
npx cdk bootstrap --context env=dev
```

Expected output: `✅ Environment aws://ACCOUNT/us-east-1 bootstrapped`
✅  Environment aws://637423369471/us-east-1 bootstrapped.

You only do this once per AWS account per region.

---

## PHASE 2 — Deploy Storage + Auth stacks

**Goal:** Create S3 buckets, DynamoDB tables, and Cognito user pool in AWS.

```bash
cd infrastructure
npx cdk deploy InvoiceStorage-dev InvoiceAuth-dev --context env=dev
```

This creates:
- S3 bucket: `invoice-uploads-dev-ACCOUNTID` — where invoices are uploaded
- S3 bucket: `invoice-processed-dev-ACCOUNTID` — where extracted text goes
- S3 bucket: `invoice-frontend-dev-ACCOUNTID` — where React app will be hosted
- SQS queue: `invoice-processing-dev` — owned here to avoid CDK circular dependency
- SQS dead-letter queue: `invoice-processing-dlq-dev`
- S3 → SQS event notification (wired in the same stack)
- DynamoDB table: `invoices-dev` — main invoice data store
- DynamoDB table: `processing-jobs-dev` — tracks pipeline progress
- Cognito User Pool: `invoice-platform-users-dev`
- Cognito Client ID for the web app

**Copy the outputs — you need them later:**
```
InvoiceStorage-dev.UploadsBucketName   = invoice-uploads-dev-XXXX
InvoiceStorage-dev.InvoicesTableName   = invoices-dev
InvoiceAuth-dev.UserPoolId             = us-east-1_XXXXXXXXX
InvoiceAuth-dev.UserPoolClientId       = XXXXXXXXXXXXXXXXXXXXXXXXXX

Outputs:
InvoiceStorage-dev.DLQUrl = https://sqs.us-east-1.amazonaws.com/637423369471/invoice-processing-dlq-dev
InvoiceStorage-dev.ExportsOutputFnGetAttInvoicesTable011644E3Arn7C092917 = arn:aws:dynamodb:us-east-1:637423369471:table/invoices-dev
InvoiceStorage-dev.ExportsOutputFnGetAttJobsTable1970BC16ArnC40C1624 = arn:aws:dynamodb:us-east-1:637423369471:table/processing-jobs-dev
InvoiceStorage-dev.ExportsOutputFnGetAttProcessedBucketDE59930CArn662A1615 = arn:aws:s3:::invoice-processed-dev-637423369471
InvoiceStorage-dev.ExportsOutputFnGetAttProcessingDLQ145B1707QueueName11B8354E = invoice-processing-dlq-dev
InvoiceStorage-dev.ExportsOutputFnGetAttProcessingQueue6DC600C3ArnEF236E7B = arn:aws:sqs:us-east-1:637423369471:invoice-processing-dev
InvoiceStorage-dev.ExportsOutputFnGetAttUploadsBucket5E5E9B64Arn8603C131 = arn:aws:s3:::invoice-uploads-dev-637423369471
InvoiceStorage-dev.ExportsOutputRefInvoicesTable011644E32F1EBDD1 = invoices-dev
InvoiceStorage-dev.ExportsOutputRefJobsTable1970BC16EDB4A824 = processing-jobs-dev
InvoiceStorage-dev.ExportsOutputRefProcessedBucketDE59930C4CEBF45D = invoice-processed-dev-637423369471
InvoiceStorage-dev.ExportsOutputRefUploadsBucket5E5E9B64F2F56CC2 = invoice-uploads-dev-637423369471
InvoiceStorage-dev.FrontendBucketName = invoice-frontend-dev-637423369471
InvoiceStorage-dev.InvoicesTableName = invoices-dev
InvoiceStorage-dev.JobsTableName = processing-jobs-dev
InvoiceStorage-dev.ProcessedBucketName = invoice-processed-dev-637423369471
InvoiceStorage-dev.ProcessingQueueArn = arn:aws:sqs:us-east-1:637423369471:invoice-processing-dev
InvoiceStorage-dev.ProcessingQueueUrl = https://sqs.us-east-1.amazonaws.com/637423369471/invoice-processing-dev
InvoiceStorage-dev.UploadsBucketName = invoice-uploads-dev-637423369471


```

**Verify:**
```bash
aws s3 ls | Select-String "invoice"
aws dynamodb list-tables | Select-String "invoices"
aws cognito-idp list-user-pools --max-results 5
```

---

## PHASE 3 — Deploy Processing Pipeline

**Goal:** Create the SQS queue, Lambda functions, and Step Functions state machine.

```bash
npx cdk deploy InvoiceProcessing-dev --context env=dev
```

This creates:
- 5 Lambda functions: `invoice-ocr-dev`, `invoice-ai-analysis-dev`, `invoice-risk-scoring-dev`, `invoice-store-results-dev`, `invoice-sqs-trigger-dev`
- Step Functions state machine: `invoice-processing-pipeline-dev`
- EventBridge rule for high-risk alerts
- SNS topic for email notifications
- CloudWatch alarm on DLQ message count

> Note: The SQS queue and S3 → SQS notification were created in Phase 2 (StorageStack).
> ProcessingStack receives the queue as a reference — this avoids a CDK circular dependency.

**Copy the output:**
```
InvoiceProcessing-dev.StateMachineArn = arn:aws:states:...
```

**Verify the pipeline manually:**
```bash
# Upload one of the test invoices
aws s3 cp invoices/invoice_1.png s3://invoice-uploads-dev-ACCOUNTID/invoices/test-user/invoice_1.png

# Wait 15 seconds, then check Step Functions
aws stepfunctions list-executions --state-machine-arn arn:aws:states:us-east-1:637423369471:stateMachine:invoice-processing-pipeline-dev --max-results 5

# Check DynamoDB for the result
aws dynamodb scan --table-name invoices-dev --limit 1
```

Expected: Step Functions shows a SUCCEEDED execution. DynamoDB shows a record with `risk_score`, `risk_level`, and `anomalies` array.

---

## PHASE 4 — Deploy API Stack

**Goal:** Expose the data to the frontend via REST API with Cognito auth.

```bash
npx cdk deploy InvoiceApi-dev --context env=dev
```

This creates:
- API Gateway REST API: `invoice-intelligence-api-dev`
- Cognito authorizer on all routes
- 3 API Lambda functions: upload, invoices, analytics
- Routes: `/invoices/*`, `/analytics/*`

**Copy the output:**
```
InvoiceApi-dev.ApiUrl = https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/v1/
```

**Test the API (unauthenticated — should get 401):**
```bash
curl https://YOUR_API_URL/invoices
# Expected: {"message":"Unauthorized"}  ← correct, auth is working
```

---

## PHASE 5 — Configure and run the frontend locally

**Goal:** See the dashboard in your browser connected to real AWS.

**Step 5.1 — Create env file:**
```bash
cp frontend/.env.example frontend/.env.local
```

Edit `frontend/.env.local` and fill in the 3 values from earlier phases:
```
VITE_API_URL=https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Step 5.2 — Install and run:**
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

**Step 5.3 — Create a test account:**
1. Click "Sign up"
2. Enter your email and a strong password
3. Check your email for the verification code
4. Enter the code

**Step 5.4 — Test the full flow:**
1. Sign in
2. Go to Invoices → click "Upload Invoice"
3. Drag one of the files from the `invoices/` folder
4. Watch the progress bar upload to S3
5. You are redirected to the invoice detail page
6. The status shows "Processing…" — it polls automatically
7. After ~15 seconds, the page shows the risk score, anomalies, and AI explanation
8. Go to Analytics — charts appear

---

## PHASE 6 — Deploy frontend to CloudFront

**Goal:** Host the React app on a real URL, not localhost.

**Step 6.1 — Build the app:**
```bash
cd frontend
npm run build
```

**Step 6.2 — Deploy the CDK frontend stack:**
```bash
cd infrastructure
npx cdk deploy InvoiceFrontend-dev --context env=dev
```

CDK will upload the built React app to S3 and create a CloudFront distribution.

**Copy the output:**
```
InvoiceFrontend-dev.CloudFrontUrl    = https://XXXXXXXXXXXX.cloudfront.net
InvoiceFrontend-dev.DistributionId  = EXXXXXXXXXXXXX
```

Open the CloudFront URL in your browser. The app works from the internet.

---

## PHASE 7 — Set up CI/CD with GitHub Actions

**Goal:** Every push to `main` automatically runs tests and deploys.

**Step 7.1 — Push the project to GitHub:**
```bash
git init
git add .
git commit -m "feat: initial Invoice Intelligence Platform"
git remote add origin https://github.com/YOUR_USERNAME/invoice-intelligence-platform.git
git push -u origin main
```

**Step 7.2 — Create a GitHub Actions IAM role (OIDC):**

In the AWS console:
1. Go to IAM → Identity providers → Add provider
2. Type: OpenID Connect
3. Provider URL: `https://token.actions.githubusercontent.com`
4. Audience: `sts.amazonaws.com`

Then create an IAM role:
1. IAM → Roles → Create role
2. Trust entity: Web identity → select the GitHub OIDC provider
3. Condition: `repo:YOUR_USERNAME/YOUR_REPO_NAME:ref:refs/heads/main`
4. Permissions: attach `AdministratorAccess` (narrow this down after it works)
5. Role name: `GitHubActionsDeployRole`
6. Copy the role ARN

**Step 7.3 — Add GitHub secrets:**

Go to your GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

| Name | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::ACCOUNTID:role/GitHubActionsDeployRole` |
| `FRONTEND_BUCKET` | CDK output: FrontendBucketName |
| `CF_DISTRIBUTION_ID` | CDK output: DistributionId |
| `VITE_API_URL` | CDK output: ApiUrl |
| `VITE_COGNITO_USER_POOL_ID` | CDK output: UserPoolId |
| `VITE_COGNITO_USER_POOL_CLIENT_ID` | CDK output: UserPoolClientId |

**Step 7.4 — Trigger and verify:**
```bash
# Make a small change and push
git commit --allow-empty -m "chore: trigger CI"
git push origin main
```

Go to GitHub → Actions tab. You should see both `Backend CI/CD` and `Frontend CI/CD` workflows running.

---

## PHASE 8 — Subscribe to high-risk alerts

**Goal:** Get an email when a high-risk invoice is processed.

```powershell
# Find the SNS topic ARN from CDK output or list topics:
aws sns list-topics | Select-String "invoice-high-risk"

# Subscribe your email
aws sns subscribe `
  --topic-arn arn:aws:sns:us-east-1:ACCOUNTID:invoice-high-risk-alerts-dev `
  --protocol email `
  --notification-endpoint your@email.com
```

Check your email and confirm the subscription.

Now upload an invoice that the AI will flag as high-risk — you'll receive an email notification.

---

## PHASE 9 — Verify everything end-to-end

Run through this checklist once to confirm the entire platform works:

```
[ ] aws sts get-caller-identity                              → shows your account
[ ] pytest backend/tests/unit/ -v                            → all tests pass
[ ] CDK synth completes without errors
[ ] aws s3 ls | Select-String invoice                        → S3 buckets exist
[ ] aws dynamodb list-tables | Select-String invoices        → DynamoDB tables exist
[ ] Cognito user pool exists
[ ] Upload an invoice via AWS CLI → Step Functions succeeds
[ ] Upload an invoice via the UI → dashboard shows result
[ ] Analytics page shows charts
[ ] GitHub Actions runs green on push to main
[ ] Email alert received for high-risk invoice
```

---

## Quick Reference — Useful Commands

```powershell
# Re-deploy everything
cd infrastructure; npx cdk deploy --all --context env=dev

# Run tests (activate venv first)
cd ..
.venv\Scripts\Activate.ps1
pytest backend/tests/unit/ -v

# Rebuild and redeploy frontend only
cd frontend; npm run build
aws s3 sync dist/ s3://YOUR_FRONTEND_BUCKET/ --delete
aws cloudfront create-invalidation --distribution-id YOUR_CF_ID --paths "/*"

# Watch a Step Functions execution live
aws stepfunctions get-execution-history `
  --execution-arn YOUR_EXECUTION_ARN `
  --query "events[*].{type:type,time:timestamp}" `
  --output table

# Check DynamoDB for latest invoice
aws dynamodb scan `
  --table-name invoices-dev `
  --limit 1 `
  --query "Items[0]"

# Check DLQ for failed invoices
aws sqs get-queue-attributes `
  --queue-url YOUR_DLQ_URL `
  --attribute-names ApproximateNumberOfMessages

# Stream Lambda logs (PowerShell — no 'tail' available)
aws logs tail /aws/lambda/invoice-ocr-dev --follow
aws logs tail /aws/lambda/invoice-ai-analysis-dev --follow

# List S3 buckets (PowerShell filter)
aws s3 ls | Select-String "invoice"

# List DynamoDB tables (PowerShell filter)
aws dynamodb list-tables | Select-String "invoice"

# Verify Step Functions executions
aws stepfunctions list-executions `
  --state-machine-arn YOUR_STATE_MACHINE_ARN `
  --max-results 5
```

---

## Troubleshooting

**"Textract error: InvalidS3ObjectException"**
→ The S3 key doesn't exist or the Lambda doesn't have `s3:GetObject` permission on the uploads bucket. Check the IAM role attached to `invoice-ocr-dev`.

**"Bedrock error: AccessDeniedException"**
→ Your AWS account needs Bedrock model access enabled. Go to AWS Console → Bedrock → Model access → enable `amazon.nova-micro-v1:0`.

**"Step Functions execution FAILED at OCR stage"**
→ Check CloudWatch logs:
```powershell
aws logs tail /aws/lambda/invoice-ocr-dev --follow
```

**"API returns 401"**
→ The Cognito authorizer is working correctly. You need to include the JWT: `Authorization: Bearer YOUR_ID_TOKEN` header.

**"Frontend shows blank page"**
→ Check browser console. Most likely `VITE_API_URL` or Cognito values are wrong in `.env.local`.

**"CDK deploy fails with 'bootstrapping required'"**
→ Run `npx cdk bootstrap` in the `infrastructure` folder.

**"The module '.venv' could not be loaded" when activating venv**
→ PowerShell execution policy is blocking the script. Run this once:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
Then activate normally: `.venv\Scripts\Activate.ps1`

**"grep is not recognized" in PowerShell**
→ PowerShell does not have `grep`. Use `Select-String` instead:
```powershell
aws s3 ls | Select-String "invoice"
aws dynamodb list-tables | Select-String "invoices"
```
Use `` ` `` (backtick) instead of `\` for line continuation in PowerShell.

**"DLQ has messages"**
→ Check CloudWatch logs for the `invoice-sqs-trigger-dev` Lambda. The SQS message body may not contain a valid S3 event structure.

---

## File Reference

| File | What it does |
|---|---|
| `backend/lambdas/ocr/handler.py` | Calls Textract, extracts invoice fields |
| `backend/lambdas/ocr/parser.py` | Parses raw Textract response |
| `backend/lambdas/ai_analysis/handler.py` | Calls Bedrock, returns structured JSON anomalies |
| `backend/lambdas/ai_analysis/prompt_builder.py` | Builds the structured AI prompt |
| `backend/lambdas/risk_scoring/handler.py` | Combines AI + rules into 0–100 score |
| `backend/lambdas/risk_scoring/rules.py` | Deterministic business rules (math error, missing fields, etc.) |
| `backend/lambdas/store_results/handler.py` | Writes to DynamoDB, fires EventBridge event |
| `backend/lambdas/sqs_trigger/handler.py` | Reads SQS, starts Step Functions execution |
| `backend/lambdas/api/upload.py` | Generates pre-signed S3 URL |
| `backend/lambdas/api/invoices.py` | CRUD for invoices (list, get, delete, status) |
| `backend/lambdas/api/analytics.py` | Aggregated analytics data for charts |
| `backend/lambdas/shared/db.py` | DynamoDB helpers used by all Lambdas |
| `backend/lambdas/shared/models.py` | Pydantic data models |
| `backend/lambdas/shared/response.py` | API response helpers + CORS headers |
| `backend/step-functions/processing-pipeline.json` | State machine definition (reference) |
| `infrastructure/lib/storage-stack.ts` | S3 + DynamoDB CDK |
| `infrastructure/lib/auth-stack.ts` | Cognito CDK |
| `infrastructure/lib/processing-stack.ts` | SQS + Step Functions + Lambda CDK |
| `infrastructure/lib/api-stack.ts` | API Gateway CDK |
| `infrastructure/lib/frontend-stack.ts` | CloudFront + S3 static CDK |
| `frontend/src/pages/DashboardPage.tsx` | Main dashboard with KPIs + upload widget |
| `frontend/src/pages/InvoicesPage.tsx` | Invoice list with filters |
| `frontend/src/pages/InvoiceDetailPage.tsx` | Full invoice detail + AI report |
| `frontend/src/pages/AnalyticsPage.tsx` | All 4 analytics charts |
| `frontend/src/pages/LoginPage.tsx` | Sign in / sign up / verify |
| `frontend/src/services/api.ts` | All API calls (axios + JWT) |
| `frontend/src/services/upload.ts` | Pre-signed URL upload to S3 |
| `frontend/src/services/auth.ts` | Cognito auth (Amplify) |
| `.github/workflows/backend.yml` | Tests + CDK deploy on push to main |
| `.github/workflows/frontend.yml` | Build + S3 deploy + CF invalidation |
| `.github/workflows/pr-checks.yml` | Tests + type-check on every PR |

---

## CDK Issues We Fixed (Reference)

These errors came up during `npx cdk synth` and were fixed. Documented here so you understand what changed and why.

---

### Fix 1 — `S3StaticWebsiteOrigin` does not exist

**Error:**
```
error TS2339: Property 'S3StaticWebsiteOrigin' does not exist on type
'typeof import("aws-cdk-lib/aws-cloudfront-origins")'
```

**Cause:** `S3StaticWebsiteOrigin` was removed in newer CDK versions.

**Fix in `infrastructure/lib/frontend-stack.ts`:**
```typescript
// Before (broken)
origin: new cloudfront_origins.S3StaticWebsiteOrigin(frontendBucket),

// After (correct)
origin: cloudfront_origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
```

---

### Fix 2 — CDK package versions were too old

**Error:**
```
npm error notarget No matching version found for aws-cdk-lib@2.134.0
```

**Cause:** `package.json` had version `2.134.0` which no longer exists on npm. The CDK CLI and library versions also diverged — they now use separate version numbers.

**Fix in `infrastructure/package.json`:**
```json
"devDependencies": {
  "aws-cdk": "2.1138.0",
  "typescript": "~5.4.0",
  "ts-node": "^10.9.2"
},
"dependencies": {
  "aws-cdk-lib": "2.266.0",
  "constructs": "^10.0.0",
  "source-map-support": "^0.5.21"
}
```

> Rule: `aws-cdk` (CLI) and `aws-cdk-lib` (library) now have different version numbers.
> Always check the latest with `npm show aws-cdk version` and `npm show aws-cdk-lib version`.

After updating, always run:
```powershell
# Delete old node_modules and reinstall cleanly
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```

---

### Fix 3 — CDK circular dependency between StorageStack and ProcessingStack

**Error:**
```
DependencyCycle: 'InvoiceProcessing-dev' depends on 'InvoiceStorage-dev'.
Adding this dependency would create a cyclic reference.
```

**Cause:** The original design called `uploadsBucket.addEventNotification(sqsQueue)` inside `ProcessingStack`. CDK detected that:
- `ProcessingStack` depends on `StorageStack` (needs the bucket)
- `StorageStack` would depend on `ProcessingStack` (needs the SQS queue for the notification)
- → Circular dependency

**Fix:** Move the SQS queue AND the S3 → SQS notification into `StorageStack` so both resources live in the same stack. `ProcessingStack` receives the queue as a constructor prop.

`infrastructure/lib/storage-stack.ts` — now also exports:
```typescript
public readonly processingQueue: sqs.Queue;
public readonly processingDlq: sqs.Queue;
```

And wires the S3 notification internally:
```typescript
this.uploadsBucket.addEventNotification(
  s3.EventType.OBJECT_CREATED,
  new s3n.SqsDestination(this.processingQueue),
  { prefix: 'invoices/' }
);
```

`infrastructure/lib/processing-stack.ts` — receives the queue as a prop:
```typescript
interface ProcessingStackProps extends cdk.StackProps {
  // ...existing props...
  processingQueue: sqs.Queue;   // passed in from StorageStack
  processingDlq: sqs.Queue;
}
```

`infrastructure/bin/app.ts` — passes the queue when constructing ProcessingStack:
```typescript
const processingStack = new ProcessingStack(app, `InvoiceProcessing-${env}`, {
  // ...
  processingQueue: storageStack.processingQueue,
  processingDlq:   storageStack.processingDlq,
});
```

---

### Fix 4 — Deprecated CDK APIs

Several CDK APIs used in the original code were deprecated in `aws-cdk-lib@2.266.0`. All fixed with the replacement APIs:

| Deprecated | Replacement | File |
|---|---|---|
| `logRetention: RetentionDays.X` on Lambda | `logGroup: new logs.LogGroup(...)` | `processing-stack.ts`, `api-stack.ts` |
| `definition: chainable` on StateMachine | `definitionBody: DefinitionBody.fromChainable(chainable)` | `processing-stack.ts` |
| `pointInTimeRecovery: boolean` on Table | `pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: bool }` | `storage-stack.ts` |
| `stack.addDependency(other)` | `stack.addStackDependency(other)` | `bin/app.ts` |

---

### What a clean `cdk synth` looks like

After all fixes, running `npx cdk synth --context env=dev --quiet` should end with:

```
Successfully synthesized to infrastructure/cdk.out
Supply a stack id (InvoiceStorage-dev, InvoiceAuth-dev, InvoiceProcessing-dev,
InvoiceApi-dev, InvoiceFrontend-dev) to display its template.
67 feature flags are not configured. Run 'cdk flags --unstable=flags' to learn more.
```

The "67 feature flags" line is informational — not an error. Synth is successful.
