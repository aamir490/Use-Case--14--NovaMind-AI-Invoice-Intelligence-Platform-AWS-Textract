import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  envName: string;
}

/**
 * StorageStack owns all persistent resources AND the SQS queue.
 * Keeping both the S3 bucket and the SQS queue here avoids the CDK
 * cross-stack circular dependency that arises when ProcessingStack tries
 * to call bucket.addEventNotification() on a bucket it doesn't own.
 */
export class StorageStack extends cdk.Stack {
  public readonly uploadsBucket: s3.Bucket;
  public readonly processedBucket: s3.Bucket;
  public readonly frontendBucket: s3.Bucket;
  public readonly invoicesTable: dynamodb.Table;
  public readonly jobsTable: dynamodb.Table;
  // Queue and DLQ exported so ProcessingStack can attach the SQS trigger Lambda
  public readonly processingQueue: sqs.Queue;
  public readonly processingDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { envName } = props;
    const removalPolicy = envName === 'prod'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // ── SQS: processing queue + DLQ ───────────────────────────────────────
    // Lives here so the S3 → SQS notification stays in the same stack.
    this.processingDlq = new sqs.Queue(this, 'ProcessingDLQ', {
      queueName: `invoice-processing-dlq-${envName}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      queueName: `invoice-processing-${envName}`,
      visibilityTimeout: cdk.Duration.seconds(120),
      deadLetterQueue: { queue: this.processingDlq, maxReceiveCount: 3 },
    });

    // ── S3: Invoice uploads ────────────────────────────────────────────────
    this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      bucketName: `invoice-uploads-${envName}-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      autoDeleteObjects: envName !== 'prod',
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'MoveToIntelligentTiering',
          transitions: [{
            storageClass: s3.StorageClass.INTELLIGENT_TIERING,
            transitionAfter: cdk.Duration.days(30),
          }],
        },
        {
          id: 'ExpireOldVersions',
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
    });

    // S3 → SQS notification (same stack — no circular dependency)
    this.uploadsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(this.processingQueue),
      { prefix: 'invoices/' }
    );

    // ── S3: Processed text output ──────────────────────────────────────────
    this.processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      bucketName: `invoice-processed-${envName}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      autoDeleteObjects: envName !== 'prod',
    });

    // ── S3: React SPA static hosting ──────────────────────────────────────
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `invoice-frontend-${envName}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      autoDeleteObjects: envName !== 'prod',
    });

    // ── DynamoDB: invoices ─────────────────────────────────────────────────
    this.invoicesTable = new dynamodb.Table(this, 'InvoicesTable', {
      tableName:    `invoices-${envName}`,
      partitionKey: { name: 'tenant_id',  type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'invoice_id', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption:   dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: envName === 'prod' },
      removalPolicy,
    });

    this.invoicesTable.addGlobalSecondaryIndex({
      indexName:      'status-created-index',
      partitionKey:   { name: 'status',     type: dynamodb.AttributeType.STRING },
      sortKey:        { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.invoicesTable.addGlobalSecondaryIndex({
      indexName:      'risk-level-index',
      partitionKey:   { name: 'risk_level', type: dynamodb.AttributeType.STRING },
      sortKey:        { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── DynamoDB: processing_jobs ──────────────────────────────────────────
    this.jobsTable = new dynamodb.Table(this, 'JobsTable', {
      tableName:    `processing-jobs-${envName}`,
      partitionKey: { name: 'job_id', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      timeToLiveAttribute: 'ttl',
    });

    // ── CloudFormation outputs ─────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UploadsBucketName',    { value: this.uploadsBucket.bucketName });
    new cdk.CfnOutput(this, 'ProcessedBucketName',  { value: this.processedBucket.bucketName });
    new cdk.CfnOutput(this, 'FrontendBucketName',   { value: this.frontendBucket.bucketName });
    new cdk.CfnOutput(this, 'InvoicesTableName',    { value: this.invoicesTable.tableName });
    new cdk.CfnOutput(this, 'JobsTableName',        { value: this.jobsTable.tableName });
    new cdk.CfnOutput(this, 'ProcessingQueueUrl',   { value: this.processingQueue.queueUrl });
    new cdk.CfnOutput(this, 'ProcessingQueueArn',   { value: this.processingQueue.queueArn });
    new cdk.CfnOutput(this, 'DLQUrl',               { value: this.processingDlq.queueUrl });
  }
}
