import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import * as path from 'path';

interface ProcessingStackProps extends cdk.StackProps {
  envName: string;
  uploadsBucket: s3.Bucket;
  processedBucket: s3.Bucket;
  invoicesTable: dynamodb.Table;
  jobsTable: dynamodb.Table;
  processingQueue: sqs.Queue;
  processingDlq: sqs.Queue;
}

export class ProcessingStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;
  public readonly processingQueue: sqs.Queue;

  constructor(
    scope: Construct,
    id: string,
    props: ProcessingStackProps
  ) {
    super(scope, id, props);

    const {
      envName,
      uploadsBucket,
      processedBucket,
      invoicesTable,
      jobsTable,
      processingQueue,
      processingDlq,
    } = props;

    const lambdaRoot = path.join(
      __dirname,
      '../../backend/lambdas'
    );

    // ================================================================
    // SHARED LAMBDA LAYER
    // ================================================================
    //
    // Expected structure:
    //
    // backend/
    // └── lambdas/
    //     └── shared/
    //         ├── __init__.py
    //         ├── db.py
    //         ├── models.py
    //         ├── exceptions.py
    //         ├── response.py
    //         └── requirements.txt
    //
    // The layer will be packaged as:
    //
    // python/
    // ├── __init__.py
    // ├── db.py
    // ├── models.py
    // ├── ...
    // └── installed Python dependencies
    //
    // ================================================================

    const sharedLayer = new lambda.LayerVersion(
      this,
      'SharedLayer',
      {
        layerVersionName: `invoice-shared-${envName}`,
        code: lambda.Code.fromAsset(
          path.join(lambdaRoot, 'shared-layer')
        ),
        compatibleRuntimes: [
          lambda.Runtime.PYTHON_3_12,
        ],
        compatibleArchitectures: [
          lambda.Architecture.ARM_64,
        ],
        description:
          'Shared utilities, database helpers, models, exceptions, response helpers and common Python dependencies',
      }
    );

    // ================================================================
    // SHARED ENVIRONMENT VARIABLES
    // ================================================================

    const sharedEnv = {
      INVOICES_TABLE:
        invoicesTable.tableName,

      JOBS_TABLE:
        jobsTable.tableName,

      UPLOADS_BUCKET:
        uploadsBucket.bucketName,

      PROCESSED_BUCKET:
        processedBucket.bucketName,

      BEDROCK_MODEL_ID:
        'us.amazon.nova-micro-v1:0',

      EVENTBRIDGE_BUS_NAME:
        'invoice-platform',
    };

    // ================================================================
    // CLOUDWATCH LOG GROUP HELPER
    // ================================================================

    const logGroup = (name: string) =>
      new logs.LogGroup(
        this,
        `${name}Logs`,
        {
          logGroupName:
            `/aws/lambda/${name}-${envName}`,

          retention:
            logs.RetentionDays.TWO_WEEKS,

          removalPolicy:
            cdk.RemovalPolicy.DESTROY,
        }
      );

    // ================================================================
    // PROCESSING QUEUE
    // ================================================================

    this.processingQueue =
      processingQueue;

    // ================================================================
    // OCR LAMBDA
    // ================================================================

    const ocrLambda =
      new lambda.Function(
        this,
        'OcrFunction',
        {
          functionName:
            `invoice-ocr-${envName}`,

          runtime:
            lambda.Runtime.PYTHON_3_12,

          architecture:
            lambda.Architecture.ARM_64,

          code:
            lambda.Code.fromAsset(
              path.join(
                lambdaRoot,
                'ocr'
              )
            ),

          handler:
            'handler.handler',

          environment:
            {
              ...sharedEnv,
            },

          timeout:
            cdk.Duration.seconds(60),

          memorySize:
            256,

          tracing:
            lambda.Tracing.ACTIVE,

          logGroup:
            logGroup(
              'invoice-ocr'
            ),

          layers:
            [sharedLayer],
        }
      );

    // S3 read permission
    uploadsBucket.grantRead(
      ocrLambda
    );

    // Textract permission
    ocrLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'textract:AnalyzeExpense',
        ],

        resources: ['*'],
      })
    );

    // Jobs table permissions
    jobsTable.grantReadWriteData(
      ocrLambda
    );

    // ================================================================
    // AI ANALYSIS LAMBDA
    // ================================================================

    const aiLambda =
      new lambda.Function(
        this,
        'AIAnalysisFunction',
        {
          functionName:
            `invoice-ai-analysis-${envName}`,

          runtime:
            lambda.Runtime.PYTHON_3_12,

          architecture:
            lambda.Architecture.ARM_64,

          code:
            lambda.Code.fromAsset(
              path.join(
                lambdaRoot,
                'ai_analysis'
              )
            ),

          handler:
            'handler.handler',

          environment:
            {
              ...sharedEnv,
            },

          timeout:
            cdk.Duration.seconds(60),

          memorySize:
            512,

          tracing:
            lambda.Tracing.ACTIVE,

          logGroup:
            logGroup(
              'invoice-ai-analysis'
            ),

          layers:
            [sharedLayer],
        }
      );

    // Bedrock permission
    aiLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
        ],

        resources: ['*'],
      })
    );

    // Jobs table permissions
    jobsTable.grantReadWriteData(
      aiLambda
    );

    // ================================================================
    // RISK SCORING LAMBDA
    // ================================================================

    const riskLambda =
      new lambda.Function(
        this,
        'RiskScoringFunction',
        {
          functionName:
            `invoice-risk-scoring-${envName}`,

          runtime:
            lambda.Runtime.PYTHON_3_12,

          architecture:
            lambda.Architecture.ARM_64,

          code:
            lambda.Code.fromAsset(
              path.join(
                lambdaRoot,
                'risk_scoring'
              )
            ),

          handler:
            'handler.handler',

          environment:
            {
              ...sharedEnv,
            },

          timeout:
            cdk.Duration.seconds(30),

          memorySize:
            256,

          tracing:
            lambda.Tracing.ACTIVE,

          logGroup:
            logGroup(
              'invoice-risk-scoring'
            ),

          layers:
            [sharedLayer],
        }
      );

    jobsTable.grantReadWriteData(
      riskLambda
    );

    // ================================================================
    // STORE RESULTS LAMBDA
    // ================================================================

    const storeLambda =
      new lambda.Function(
        this,
        'StoreResultsFunction',
        {
          functionName:
            `invoice-store-results-${envName}`,

          runtime:
            lambda.Runtime.PYTHON_3_12,

          architecture:
            lambda.Architecture.ARM_64,

          code:
            lambda.Code.fromAsset(
              path.join(
                lambdaRoot,
                'store_results'
              )
            ),

          handler:
            'handler.handler',

          environment:
            {
              ...sharedEnv,
            },

          timeout:
            cdk.Duration.seconds(30),

          memorySize:
            256,

          tracing:
            lambda.Tracing.ACTIVE,

          logGroup:
            logGroup(
              'invoice-store-results'
            ),

          layers:
            [sharedLayer],
        }
      );

    // DynamoDB permissions
    invoicesTable.grantWriteData(
      storeLambda
    );

    jobsTable.grantReadWriteData(
      storeLambda
    );

    // Processed bucket permission
    processedBucket.grantWrite(
      storeLambda
    );

    // EventBridge permission
    storeLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'events:PutEvents',
        ],

        resources: ['*'],
      })
    );

    // ================================================================
    // STEP FUNCTIONS TASKS
    // ================================================================

    const ocrTask =
      new tasks.LambdaInvoke(
        this,
        'OCRTask',
        {
          lambdaFunction:
            ocrLambda,

          outputPath:
            '$.Payload',

          retryOnServiceExceptions:
            true,
        }
      );

    const aiTask =
      new tasks.LambdaInvoke(
        this,
        'AIAnalysisTask',
        {
          lambdaFunction:
            aiLambda,

          outputPath:
            '$.Payload',

          retryOnServiceExceptions:
            true,
        }
      );

    const riskTask =
      new tasks.LambdaInvoke(
        this,
        'RiskScoringTask',
        {
          lambdaFunction:
            riskLambda,

          outputPath:
            '$.Payload',
        }
      );

    const storeTask =
      new tasks.LambdaInvoke(
        this,
        'StoreResultsTask',
        {
          lambdaFunction:
            storeLambda,

          outputPath:
            '$.Payload',
        }
      );

    // ================================================================
    // STEP FUNCTIONS FAILURE HANDLER
    // ================================================================

    const handleFailure =
      new tasks.DynamoUpdateItem(
        this,
        'HandleFailure',
        {
          table:
            jobsTable,

          key: {
            job_id:
              tasks.DynamoAttributeValue.fromString(
                sfn.JsonPath.stringAt(
                  '$.job_id'
                )
              ),
          },

          updateExpression:
            'SET #s = :failed, updated_at = :now',

          expressionAttributeNames: {
            '#s': 'status',
          },

          expressionAttributeValues: {
            ':failed':
              tasks.DynamoAttributeValue.fromString(
                'FAILED'
              ),

            ':now':
              tasks.DynamoAttributeValue.fromString(
                sfn.JsonPath.stringAt(
                  '$$.Execution.StartTime'
                )
              ),
          },
        }
      );

    // ================================================================
    // RETRIES
    // ================================================================

    ocrTask.addRetry({
      errors: [
        'Lambda.ServiceException',
      ],

      maxAttempts: 2,

      interval:
        cdk.Duration.seconds(2),

      backoffRate: 2,
    });

    ocrTask.addCatch(
      handleFailure,
      {
        resultPath:
          '$.error',
      }
    );

    aiTask.addRetry({
      errors: [
        'Lambda.ServiceException',
      ],

      maxAttempts: 3,

      interval:
        cdk.Duration.seconds(5),

      backoffRate: 2,
    });

    aiTask.addCatch(
      handleFailure,
      {
        resultPath:
          '$.error',
      }
    );

    riskTask.addCatch(
      handleFailure,
      {
        resultPath:
          '$.error',
      }
    );

    storeTask.addRetry({
      errors: [
        'Lambda.ServiceException',
      ],

      maxAttempts: 3,

      interval:
        cdk.Duration.seconds(2),

      backoffRate: 2,
    });

    storeTask.addCatch(
      handleFailure,
      {
        resultPath:
          '$.error',
      }
    );

    // ================================================================
    // STATE MACHINE DEFINITION
    // ================================================================

    const definition =
      ocrTask
        .next(aiTask)
        .next(riskTask)
        .next(storeTask);

    // ================================================================
    // STEP FUNCTIONS LOG GROUP
    // ================================================================

    const sfnLogGroup =
      new logs.LogGroup(
        this,
        'SfnLogs',
        {
          logGroupName:
            `/aws/states/invoice-pipeline-${envName}`,

          retention:
            logs.RetentionDays.TWO_WEEKS,

          removalPolicy:
            cdk.RemovalPolicy.DESTROY,
        }
      );

    // ================================================================
    // STEP FUNCTIONS STATE MACHINE
    // ================================================================

    this.stateMachine =
      new sfn.StateMachine(
        this,
        'ProcessingPipeline',
        {
          stateMachineName:
            `invoice-processing-pipeline-${envName}`,

          definitionBody:
            sfn.DefinitionBody.fromChainable(
              definition
            ),

          stateMachineType:
            sfn.StateMachineType.EXPRESS,

          timeout:
            cdk.Duration.minutes(5),

          tracingEnabled:
            true,

          logs: {
            destination:
              sfnLogGroup,

            level:
              sfn.LogLevel.ERROR,

            includeExecutionData:
              true,
          },
        }
      );

    // ================================================================
    // SQS TRIGGER LAMBDA
    // ================================================================

    const sqsTriggerLambda =
      new lambda.Function(
        this,
        'SQSTriggerFunction',
        {
          functionName:
            `invoice-sqs-trigger-${envName}`,

          runtime:
            lambda.Runtime.PYTHON_3_12,

          architecture:
            lambda.Architecture.ARM_64,

          code:
            lambda.Code.fromAsset(
              path.join(
                lambdaRoot,
                'sqs_trigger'
              )
            ),

          handler:
            'handler.handler',

          environment: {
            ...sharedEnv,

            STATE_MACHINE_ARN:
              this.stateMachine
                .stateMachineArn,
          },

          timeout:
            cdk.Duration.seconds(30),

          memorySize:
            256,

          tracing:
            lambda.Tracing.ACTIVE,

          logGroup:
            logGroup(
              'invoice-sqs-trigger'
            ),

          layers:
            [sharedLayer],
        }
      );

    // Start Step Functions execution
    this.stateMachine.grantStartExecution(
      sqsTriggerLambda
    );

    // Jobs table permission
    jobsTable.grantReadWriteData(
      sqsTriggerLambda
    );

    // SQS event source
    sqsTriggerLambda.addEventSource(
      new lambda_event_sources.SqsEventSource(
        processingQueue,
        {
          batchSize: 1,

          reportBatchItemFailures:
            true,
        }
      )
    );

    // ================================================================
    // EVENTBRIDGE + SNS HIGH-RISK ALERT
    // ================================================================

    const alertTopic =
      new sns.Topic(
        this,
        'HighRiskAlertTopic',
        {
          topicName:
            `invoice-high-risk-alerts-${envName}`,
        }
      );

    new events.Rule(
      this,
      'HighRiskRule',
      {
        ruleName:
          `invoice-high-risk-${envName}`,

        eventPattern: {
          source: [
            'invoice-platform',
          ],

          detailType: [
            'InvoiceProcessed',
          ],

          detail: {
            risk_level: [
              'HIGH',
            ],
          },
        },

        targets: [
          new events_targets.SnsTopic(
            alertTopic
          ),
        ],
      }
    );

    // ================================================================
    // DLQ CLOUDWATCH ALARM
    // ================================================================

    const dlqAlarm =
      new cloudwatch.Alarm(
        this,
        'DLQAlarm',
        {
          alarmName:
            `invoice-dlq-messages-${envName}`,

          alarmDescription:
            'Messages in DLQ — invoice processing failed',

          metric:
            processingDlq.metricApproximateNumberOfMessagesVisible(),

          threshold: 1,

          evaluationPeriods: 1,

          comparisonOperator:
            cloudwatch.ComparisonOperator
              .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,

          treatMissingData:
            cloudwatch.TreatMissingData
              .NOT_BREACHING,
        }
      );

    dlqAlarm.addAlarmAction(
      new cloudwatch_actions.SnsAction(
        alertTopic
      )
    );

    // ================================================================
    // CLOUDFORMATION OUTPUTS
    // ================================================================

    new cdk.CfnOutput(
      this,
      'StateMachineArn',
      {
        value:
          this.stateMachine
            .stateMachineArn,
      }
    );

    new cdk.CfnOutput(
      this,
      'AlertTopicArn',
      {
        value:
          alertTopic.topicArn,
      }
    );
  }
}