# NovaMind Ai Invoice Intelligence Platform
### Deploy Guide — For Anyone Who Cloned This Repo

> Built by [Aamir](https://github.com/aamir490) · [LinkedIn](https://www.linkedin.com/in/aamir-imran)

---

## What You Need First

Install these 4 tools before anything else:

| Tool | Download |
|------|----------|
| Node.js 20 (LTS) | https://nodejs.org |
| Python 3.12 | https://python.org/downloads |
| AWS CLI v2 | https://aws.amazon.com/cli |
| Git | https://git-scm.com |

---

## Step 1 — Configure AWS

```bash
aws configure
```

Enter your AWS Access Key, Secret Key, region (`us-east-1`), output format (`json`).

Check it works:
```bash
aws sts get-caller-identity
```
You should see your Account ID.

---

## Step 2 — Enable Bedrock Model Access

1. Open AWS Console → search **Bedrock** → open it
2. Left sidebar → **Model access** → **Manage model access**
3. Tick **Amazon Nova Micro**
4. Click **Save changes** → wait for **Access granted**

> Skip this and the AI step will fail when you upload invoices.

---

## Step 3 — Clone and Install

```bash
git clone https://github.com/aamir490/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME
```

Install dependencies:
```bash
cd infrastructure
npm ci
cd ../frontend
npm ci
cd ..
```

---

## Step 4 — Build the Lambda Layer

All Lambda functions share common code. Run this once to package it:

```bash
# Mac/Linux
mkdir -p backend/lambdas/shared-layer-v2/python/shared
cp backend/lambdas/shared/*.py backend/lambdas/shared-layer-v2/python/shared/
pip install pydantic>=2.0.0 boto3>=1.34.0 -t backend/lambdas/shared-layer-v2/python --quiet
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Path "backend\lambdas\shared-layer-v2\python\shared" -Force | Out-Null
Copy-Item "backend\lambdas\shared\*.py" "backend\lambdas\shared-layer-v2\python\shared\" -Force
pip install pydantic>=2.0.0 boto3>=1.34.0 -t "backend\lambdas\shared-layer-v2\python" --quiet
```

---

## Step 5 — Deploy to AWS

```bash
cd infrastructure
npm run build
```

Bootstrap CDK (one-time only):
```bash
npx cdk bootstrap
```

Deploy all stacks:
```bash
npx cdk deploy InvoiceStorage-dev InvoiceAuth-dev --context env=dev --require-approval never
npx cdk deploy InvoiceProcessing-dev InvoiceApi-dev --context env=dev --require-approval never
```

Takes about 8 minutes total.

---

## Step 6 — Attach the Lambda Layer

```bash
# Windows
powershell -ExecutionPolicy Bypass -File fix-layer.ps1
powershell -ExecutionPolicy Bypass -File fix-processing-layer.ps1
```

```bash
# Mac/Linux — run these commands instead
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1
ZIP="shared-layer.zip"

cd backend/lambdas/shared-layer-v2 && zip -r "../../../$ZIP" . && cd ../../..

ARN=$(aws lambda publish-layer-version \
  --layer-name invoice-api-shared-dev \
  --compatible-runtimes python3.12 \
  --zip-file fileb://$ZIP \
  --query LayerVersionArn --output text)

for fn in invoice-api-upload-dev invoice-api-invoices-dev invoice-api-analytics-dev \
          invoice-ocr-dev invoice-ai-analysis-dev invoice-risk-scoring-dev \
          invoice-store-results-dev invoice-sqs-trigger-dev; do
  aws lambda update-function-configuration --function-name $fn --layers $ARN
  aws lambda wait function-updated --function-name $fn
  echo "$fn updated"
done
```

The `fix-layer.ps1` script will print `"statusCode": 201` at the end — that confirms it worked.

---

## Step 7 — Configure the Frontend

Get your values from AWS:
```bash
aws cloudformation describe-stacks --stack-name InvoiceApi-dev \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text

aws cloudformation describe-stacks --stack-name InvoiceAuth-dev \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text

aws cloudformation describe-stacks --stack-name InvoiceAuth-dev \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text
```

Create `frontend/.env.local` with those values:
```
VITE_API_URL=https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
```

> No trailing slash on the URL. It must end in `/v1` not `/v1/`

---

## Step 8 — Create a Login User

```bash
POOL_ID=$(aws cloudformation describe-stacks --stack-name InvoiceAuth-dev \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)

aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username "demo@example.com" \
  --temporary-password "Temp@1234!" \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username "demo@example.com" \
  --password "Demo@Invoice2026!" \
  --permanent
```

---

## Step 9 — Run the App

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173**

Login: `demo@example.com` / `Demo@Invoice2026!`

Go to **Invoices → Upload Invoice** and upload any image (PNG, JPG, PDF).
In 15–30 seconds you will see the invoice processed with a risk score and AI analysis.

---

## Step 10 — Deploy Frontend to CloudFront (Optional)

For a public HTTPS URL:

```bash
cd frontend && npm run build && cd ../infrastructure
npx cdk deploy InvoiceFrontend-dev --context env=dev --require-approval never
```

Get your URL:
```bash
aws cloudformation describe-stacks --stack-name InvoiceFrontend-dev \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text
```

Then add it to `ALLOWED_ORIGINS` in `infrastructure/lib/api-stack.ts` and redeploy:
```bash
npm run build
npx cdk deploy InvoiceApi-dev --context env=dev --require-approval never
```

---

## Destroy Everything

When done, delete all AWS resources:

```bash
cd infrastructure
npx cdk destroy --all --context env=dev --force
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `No module named 'shared'` (502 error) | Redo Step 4 then Step 6 |
| Upload stuck on "Processing" | Check Bedrock model access (Step 2) |
| CORS error in browser | Add your frontend URL to `ALLOWED_ORIGINS` in `api-stack.ts` and redeploy API |
| `Amplify not configured` | Check `frontend/.env.local` has all 3 values, no trailing slash |
| `npx cdk` not found | Run from inside the `infrastructure/` folder |

---

> **Created by [Aamir](https://github.com/aamir490)**
> GitHub: https://github.com/aamir490
> LinkedIn: https://www.linkedin.com/in/aamir-imran
