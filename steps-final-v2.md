# Invoice Intelligence Platform — My Deployment Guide

> Written for: **Aamir** | Machine: **Windows laptop** | Terminal: **Kiro PowerShell**
> Code is already on your laptop at:
> `E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL`

---

## IMPORTANT — Before You Start

You already have:
- The code on your laptop
- Node.js, Python, AWS CLI installed (you used them already)
- AWS credentials configured
- The `.venv` Python virtual environment

You do NOT need to:
- Install anything new
- Clone from GitHub
- Create a new folder

---

## PART 1 — CHECK YOUR MACHINE IS READY

Open the Kiro PowerShell terminal and run these one by one:

```powershell
node --version
```
Should show `v20.x.x`

```powershell
python --version
```
Should show `3.12.x`

```powershell
aws --version
```
Should show `aws-cli/2.x.x`

```powershell
aws sts get-caller-identity
```
Should show your Account ID: `637423369471`

If any of these fail, stop and fix that tool before continuing.

---

## PART 2 — ENABLE BEDROCK MODEL ACCESS

The AI part of the pipeline uses Amazon Nova Micro. You must enable it in AWS Console once.

1. Open your browser → go to **AWS Console** → search **Bedrock** → open it
2. In the left sidebar click **Model access**
3. Click **Manage model access**
4. Find **Amazon Nova Micro** in the list and tick its checkbox
5. Click **Save changes**
6. Wait until the status column shows **Access granted**

**Skip this and your invoice AI analysis will fail silently.**

---

## PART 3 — GO TO YOUR PROJECT FOLDER

In the Kiro PowerShell terminal, navigate to your project:

```powershell
cd "E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL"
```

Every command in this guide runs from this folder unless told otherwise.

---

## PART 4 — BUILD THE LAMBDA LAYER

All Lambda functions share common code from the `shared/` folder. This needs to be packaged
as a Lambda Layer first. Run this once every time you deploy fresh.

```powershell
$root   = "E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL"
$srcPy  = "$root\backend\lambdas\shared"
$outDir = "$root\backend\lambdas\shared-layer-v2\python\shared"

New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Copy-Item "$srcPy\*.py" $outDir -Force
pip install pydantic>=2.0.0 boto3>=1.34.0 -t "$root\backend\lambdas\shared-layer-v2\python" --quiet --upgrade
Write-Host "Layer built successfully."
```

Verify it worked:
```powershell
Test-Path "backend\lambdas\shared-layer-v2\python\shared\db.py"
Test-Path "backend\lambdas\shared-layer-v2\python\pydantic"
```
Both must say `True`. If not, re-run the block above.

---

## PART 5 — DEPLOY INFRASTRUCTURE

### 5a — Go into the infrastructure folder

```powershell
cd "E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL\infrastructure"
```

### 5b — Install CDK packages (only needed if you never ran this before or after a fresh clone)

```powershell
npm ci
```

### 5c — Compile TypeScript

```powershell
npm run build
```

Must finish with no errors.

### 5d — Bootstrap CDK (one-time per AWS account — skip if already done)

```powershell
npx cdk bootstrap aws://637423369471/us-east-1
```

Should say: `Environment aws://637423369471/us-east-1 bootstrapped`

### 5e — Deploy Storage and Auth

```powershell
npx cdk deploy InvoiceStorage-dev InvoiceAuth-dev --context env=dev --require-approval never
```

Wait for it to finish. Takes about 3 minutes.

Check it worked:
```powershell
aws cloudformation describe-stacks --stack-name InvoiceStorage-dev --query "Stacks[0].StackStatus" --output text
aws cloudformation describe-stacks --stack-name InvoiceAuth-dev --query "Stacks[0].StackStatus" --output text
```
Both should say `CREATE_COMPLETE`

### 5f — Deploy Processing and API

```powershell
npx cdk deploy InvoiceProcessing-dev InvoiceApi-dev --context env=dev --require-approval never
```

Wait for it to finish. Takes about 5 minutes.

Check it worked:
```powershell
aws cloudformation describe-stacks --stack-name InvoiceProcessing-dev --query "Stacks[0].StackStatus" --output text
aws cloudformation describe-stacks --stack-name InvoiceApi-dev --query "Stacks[0].StackStatus" --output text
```
Both should say `CREATE_COMPLETE`

---

## PART 6 — ATTACH THE LAMBDA LAYER

CDK deployed the functions but needs the shared layer attached separately on Windows.
Run these two scripts from your project root.

### 6a — Go back to project root

```powershell
cd "E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL"
```

### 6b — Attach layer to API Lambdas

```powershell
powershell -ExecutionPolicy Bypass -File fix-layer.ps1
```

Wait for it to finish. The last line must show `"statusCode": 201`
If it shows `No module named 'shared'` — go back to Part 4 and rebuild the layer, then run this again.

### 6c — Attach layer to Processing Lambdas

```powershell
powershell -ExecutionPolicy Bypass -File fix-processing-layer.ps1
```

Wait for it to finish. Should end with `All processing Lambdas updated.`

---

## PART 7 — SET UP THE FRONTEND

### 7a — Get your values from AWS

Run these and copy the output — you need them in the next step:

```powershell
# Your API URL
aws cloudformation describe-stacks --stack-name InvoiceApi-dev --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text

# Your Cognito User Pool ID
aws cloudformation describe-stacks --stack-name InvoiceAuth-dev --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text

# Your Cognito Client ID
aws cloudformation describe-stacks --stack-name InvoiceAuth-dev --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text
```

### 7b — Create the environment file

Open File Explorer and go to:
`E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL\frontend`

Create a new file called `.env.local` (not `.env.local.txt` — just `.env.local`)

Paste this inside it, replacing the values with what you got above:
```
VITE_API_URL=https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Remove the trailing slash from the URL if it has one. It must end in `/v1` not `/v1/`**

Your current values are already in the file from before:
```
VITE_API_URL=https://y4ny8fyzcb.execute-api.us-east-1.amazonaws.com/v1
VITE_COGNITO_USER_POOL_ID=us-east-1_S11FtLB8g
VITE_COGNITO_USER_POOL_CLIENT_ID=4ehstlnb88t4ujj233vsrqbok8
```
If these are still correct (same deployment), no change needed.

### 7c — Create a login user

```powershell
$POOL_ID = aws cloudformation describe-stacks --stack-name InvoiceAuth-dev --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text

aws cognito-idp admin-create-user --user-pool-id $POOL_ID --username "demo@example.com" --temporary-password "Temp@1234!" --message-action SUPPRESS

aws cognito-idp admin-set-user-password --user-pool-id $POOL_ID --username "demo@example.com" --password "Invoice@Demo2026!" --permanent

Write-Host "User created: demo@example.com / Invoice@Demo2026!"
```

If you get an error saying the user already exists, that is fine — it means it was already created before.

---

## PART 8 — RUN THE APP

### 8a — Install frontend packages (only if first time)

```powershell
cd "E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL\frontend"
npm ci
```

### 8b — Start the frontend

```powershell
npm run dev
```

Leave this terminal running. Open your browser and go to:
**http://localhost:5173**

### 8c — Log in

- Email: `demo@example.com`
- Password: `Invoice@Demo2026!`

You should see the Dashboard.

### 8d — Upload an invoice

1. Click **Invoices** in the left sidebar
2. Click **Upload Invoice**
3. Pick any file from:
   `E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL\invoices\`
   (use `invoice_1.png`)
4. Watch the progress bar fill up

After 15–30 seconds you will see the invoice detail page with:
- Vendor name, total amount, dates, line items
- A risk score (0–100) with a LOW / MEDIUM / HIGH badge
- An AI explanation of any problems found

### 8e — Check it worked (in a second PowerShell terminal)

```powershell
aws dynamodb scan --table-name invoices-dev --query "Count" --output text
```
Should show `1` or more.

---

## PART 9 — WATCH THE PIPELINE (Optional but useful)

While uploading invoices, open a second PowerShell terminal and run:

```powershell
cd "E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL"
powershell -ExecutionPolicy Bypass -File watch-pipeline.ps1
```

This shows live logs from all Lambda functions and Step Functions so you can see the OCR, AI, and risk scoring steps happening in real time.

---

## PART 10 — PUT IT ON CLOUDFRONT (Optional — for a real public URL)

Do this if you want to share the app via a real HTTPS link instead of localhost.

### 10a — Build the frontend

```powershell
cd "E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL\frontend"
npm run build
```

### 10b — Deploy the frontend stack

```powershell
cd "..\infrastructure"
npx cdk deploy InvoiceFrontend-dev --context env=dev --require-approval never
```

### 10c — Get your public URL

```powershell
aws cloudformation describe-stacks --stack-name InvoiceFrontend-dev --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text
```

Copy this URL (looks like `https://XXXXXXXXXXXX.cloudfront.net`) and open it in your browser.

### 10d — Allow your CloudFront URL in the API

Open this file in Kiro:
`infrastructure\lib\api-stack.ts`

Find this section near the top:
```typescript
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
];
```

Add your CloudFront URL:
```typescript
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://XXXXXXXXXXXX.cloudfront.net',
];
```

Then redeploy the API:
```powershell
cd "..\infrastructure"
npm run build
npx cdk deploy InvoiceApi-dev --context env=dev --require-approval never
```

---

## PART 11 — DESTROY EVERYTHING

When you want to delete all AWS resources and stop being charged:

```powershell
cd "E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL\infrastructure"
npx cdk destroy --all --context env=dev --force
```

This permanently deletes all S3 buckets, DynamoDB tables, Lambda functions, Cognito users, API Gateway, CloudFront, and everything else created by this project.

**This cannot be undone.**

Verify everything is gone:
```powershell
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[?contains(StackName,'Invoice')].StackName" --output table
```
Should return an empty table.

---

## TROUBLESHOOTING

### Problem: Upload shows "Network Error"
The API URL in `.env.local` has a trailing slash. Change `v1/` to `v1` and restart `npm run dev`.

### Problem: Upload shows "502 Bad Gateway"
The Lambda layer is not attached correctly. Stop the frontend, go back to Part 4 and rebuild the layer, then run Part 6 again.

### Problem: Invoice stuck on "Processing" for more than 2 minutes
Run `watch-pipeline.ps1` to see which step failed. Most common cause: Bedrock model access not enabled (go back to Part 2).

### Problem: Login shows "UserAlreadyAuthenticatedException"
You are already logged in. Refresh the page and it will redirect to the dashboard automatically.

### Problem: Login shows "Amplify not configured"
The `.env.local` file is missing or has wrong values. Check Part 7b.

### Problem: `npx cdk` command hangs or fails
Make sure you are in the `infrastructure/` folder, not the project root.

### Problem: `No module named 'shared'` in Lambda logs
The layer was not built or attached correctly. Run Part 4 → Part 6 again in order.

---

## QUICK REFERENCE

| What | Value |
|------|-------|
| Project folder | `E:\GenAi-Project-Cloudage\Trigger_OCR_Function_FM_NoSQL\new_project\Trigger_OCR_Function_FM_NoSQL` |
| AWS Region | `us-east-1` |
| AWS Account | `637423369471` |
| CDK deploy flag | `--context env=dev` |
| Local app URL | `http://localhost:5173` |
| Test login | `demo@example.com` / `Invoice@Demo2026!` |
| API URL | `https://y4ny8fyzcb.execute-api.us-east-1.amazonaws.com/v1` |
| DynamoDB table | `invoices-dev` |
| S3 uploads bucket | `invoice-uploads-dev-637423369471` |
| Pipeline log group | `/aws/states/invoice-pipeline-dev` |
