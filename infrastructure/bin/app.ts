#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { AuthStack } from '../lib/auth-stack';
import { ProcessingStack } from '../lib/processing-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

const env     = app.node.tryGetContext('env') || 'dev';
const awsEnv  = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region:  process.env.CDK_DEFAULT_REGION || 'us-east-1',
};
const tags    = { Project: 'InvoiceIntelligence', Environment: env };

// ── Stack 1: Storage (S3 + DynamoDB) ────────────────────────────────────────
const storageStack = new StorageStack(app, `InvoiceStorage-${env}`, {
  env: awsEnv, envName: env, tags,
});

// ── Stack 2: Auth (Cognito) ──────────────────────────────────────────────────
const authStack = new AuthStack(app, `InvoiceAuth-${env}`, {
  env: awsEnv, envName: env, tags,
});

// ── Stack 3: Processing Pipeline (SQS + Step Functions + Lambdas) ────────────
// NOTE: S3 → SQS event notification lives inside ProcessingStack to avoid a
// circular dependency (StorageStack ← ProcessingStack ← StorageStack).
const processingStack = new ProcessingStack(app, `InvoiceProcessing-${env}`, {
  env: awsEnv,
  envName: env,
  uploadsBucket:   storageStack.uploadsBucket,
  processedBucket: storageStack.processedBucket,
  invoicesTable:   storageStack.invoicesTable,
  jobsTable:       storageStack.jobsTable,
  processingQueue: storageStack.processingQueue,
  processingDlq:   storageStack.processingDlq,
  tags,
});
processingStack.addStackDependency(storageStack);

// ── Stack 4: API Gateway + API Lambdas ───────────────────────────────────────
const apiStack = new ApiStack(app, `InvoiceApi-${env}`, {
  env: awsEnv,
  envName: env,
  userPool:      authStack.userPool,
  uploadsBucket: storageStack.uploadsBucket,
  invoicesTable: storageStack.invoicesTable,
  jobsTable:     storageStack.jobsTable,
  tags,
});
apiStack.addStackDependency(authStack);
apiStack.addStackDependency(storageStack);

// ── Stack 5: Frontend (CloudFront + S3 static) ───────────────────────────────
const frontendStack = new FrontendStack(app, `InvoiceFrontend-${env}`, {
  env: awsEnv, envName: env, apiUrl: apiStack.apiUrl, tags,
});
frontendStack.addStackDependency(apiStack);

app.synth();
