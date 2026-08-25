import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

// Origins allowed to call the API.
// Add your CloudFront URL here once you deploy the frontend stack.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',   // Vite dev server
  'http://localhost:4173',   // Vite preview server
];

interface ApiStackProps extends cdk.StackProps {
  envName: string;
  userPool: cognito.UserPool;
  uploadsBucket: s3.Bucket;
  invoicesTable: dynamodb.Table;
  jobsTable: dynamodb.Table;
  /** Optional: CloudFront distribution URL added at deploy time */
  frontendUrl?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { envName, userPool, uploadsBucket, invoicesTable, jobsTable, frontendUrl } = props;
    const lambdaRoot = path.join(__dirname, '../../backend/lambdas');

    // ── Shared Lambda Layer ───────────────────────────────────────────────
    // Points at backend/lambdas/shared-layer/ which is pre-built locally.
    // The python/ subdirectory inside it is added to sys.path by the Lambda
    // runtime automatically, making `from shared.db import ...` work.
    // To rebuild: pip install pydantic boto3 -t backend/lambdas/shared-layer/python
    //             then copy *.py from shared/ into shared-layer/python/
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      layerVersionName: `invoice-api-shared-${envName}`,
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Shared utilities: db, models, exceptions, response helpers',
      code: lambda.Code.fromAsset(path.join(lambdaRoot, 'shared-layer')),
    });

    // Build the final allowed-origins list at deploy time
    const allowedOrigins = frontendUrl
      ? [...ALLOWED_ORIGINS, frontendUrl]
      : ALLOWED_ORIGINS;

    const sharedEnv = {
      INVOICES_TABLE:  invoicesTable.tableName,
      JOBS_TABLE:      jobsTable.tableName,
      UPLOADS_BUCKET:  uploadsBucket.bucketName,
      ALLOWED_ORIGINS: allowedOrigins.join(','),
    };

    // Helper: creates a log group (replaces deprecated logRetention)
    const logGroup = (name: string) => new logs.LogGroup(this, `${name}Logs`, {
      logGroupName: `/aws/lambda/${name}-${envName}`,
      retention:    logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── API Lambdas ────────────────────────────────────────────────────────
    const uploadLambda = new lambda.Function(this, 'UploadFunction', {
      functionName: `invoice-api-upload-${envName}`,
      runtime:      lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      timeout:      cdk.Duration.seconds(29),
      memorySize:   256,
      tracing:      lambda.Tracing.ACTIVE,
      logGroup:     logGroup('invoice-api-upload'),
      code:         lambda.Code.fromAsset(path.join(lambdaRoot, 'api')),
      handler:      'upload.handler',
      environment:  sharedEnv,
      layers:       [sharedLayer],
    });
    uploadsBucket.grantPut(uploadLambda);
    jobsTable.grantReadWriteData(uploadLambda);

    const invoicesLambda = new lambda.Function(this, 'InvoicesFunction', {
      functionName: `invoice-api-invoices-${envName}`,
      runtime:      lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      timeout:      cdk.Duration.seconds(29),
      memorySize:   256,
      tracing:      lambda.Tracing.ACTIVE,
      logGroup:     logGroup('invoice-api-invoices'),
      code:         lambda.Code.fromAsset(path.join(lambdaRoot, 'api')),
      handler:      'invoices.handler',
      environment:  sharedEnv,
      layers:       [sharedLayer],
    });
    invoicesTable.grantReadWriteData(invoicesLambda);
    jobsTable.grantReadData(invoicesLambda);
    uploadsBucket.grantDelete(invoicesLambda);

    const analyticsLambda = new lambda.Function(this, 'AnalyticsFunction', {
      functionName: `invoice-api-analytics-${envName}`,
      runtime:      lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      timeout:      cdk.Duration.seconds(29),
      memorySize:   256,
      tracing:      lambda.Tracing.ACTIVE,
      logGroup:     logGroup('invoice-api-analytics'),
      code:         lambda.Code.fromAsset(path.join(lambdaRoot, 'api')),
      handler:      'analytics.handler',
      environment:  sharedEnv,
      layers:       [sharedLayer],
    });
    invoicesTable.grantReadData(analyticsLambda);

    // ── REST API ───────────────────────────────────────────────────────────
    this.api = new apigateway.RestApi(this, 'InvoiceApi', {
      restApiName: `invoice-intelligence-api-${envName}`,
      description: 'Invoice Intelligence Platform REST API',
      deployOptions: {
        stageName: 'v1',
        tracingEnabled: true,
        dataTraceEnabled: false,  // don't log request bodies (may contain PII)
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        accessLogDestination: new apigateway.LogGroupLogDestination(
          new logs.LogGroup(this, 'ApiAccessLogs', {
            logGroupName: `/aws/apigateway/invoice-api-${envName}`,
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          })
        ),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // ── Gateway Responses — inject CORS headers into API Gateway's own error
    // responses (401/403 from the Cognito authorizer, 4xx/5xx from the stage).
    // Without these, the browser sees the error but CORS headers are missing,
    // so the browser reports a CORS error instead of the actual auth error.
    const gatewayResponseHeaders = {
      'Access-Control-Allow-Origin':  `'${allowedOrigins[0]}'`,   // primary origin (localhost dev)
      'Access-Control-Allow-Headers': `'Content-Type,Authorization,X-Api-Key'`,
      'Access-Control-Allow-Methods': `'GET,POST,DELETE,OPTIONS'`,
      'Vary':                         `'Origin'`,
    };

    const gwResponseTypes: apigateway.ResponseType[] = [
      apigateway.ResponseType.UNAUTHORIZED,            // 401 — bad/missing token
      apigateway.ResponseType.ACCESS_DENIED,           // 403 — authorizer denied
      apigateway.ResponseType.DEFAULT_4XX,             // catches remaining 4xx
      apigateway.ResponseType.DEFAULT_5XX,             // catches 5xx gateway errors
    ];

    for (const responseType of gwResponseTypes) {
      this.api.addGatewayResponse(`GwResponse${responseType.responseType.replace(/[^A-Z0-9]/g, '')}`, {
        type:            responseType,
        responseHeaders: gatewayResponseHeaders,
      });
    }

    // ── Cognito Authorizer ─────────────────────────────────────────────────
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: `invoice-authorizer-${envName}`,
      identitySource: 'method.request.header.Authorization',
    });

    const authOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const lambdaIntegration = (fn: lambda.Function) =>
      new apigateway.LambdaIntegration(fn, { proxy: true });

    // ── /invoices routes ───────────────────────────────────────────────────
    const invoicesResource = this.api.root.addResource('invoices');

    // POST /invoices/upload-url
    const uploadUrl = invoicesResource.addResource('upload-url');
    uploadUrl.addMethod('POST', lambdaIntegration(uploadLambda), authOptions);

    // GET /invoices
    invoicesResource.addMethod('GET', lambdaIntegration(invoicesLambda), authOptions);

    // GET /invoices/{id}  DELETE /invoices/{id}
    const singleInvoice = invoicesResource.addResource('{id}');
    singleInvoice.addMethod('GET',    lambdaIntegration(invoicesLambda), authOptions);
    singleInvoice.addMethod('DELETE', lambdaIntegration(invoicesLambda), authOptions);

    // GET /invoices/{id}/status
    const statusResource = singleInvoice.addResource('status');
    statusResource.addMethod('GET', lambdaIntegration(invoicesLambda), authOptions);

    // ── /analytics routes ──────────────────────────────────────────────────
    const analyticsResource = this.api.root.addResource('analytics');
    const analyticsRoutes = ['summary', 'risk-trend', 'vendor-stats', 'anomaly-types'];
    for (const route of analyticsRoutes) {
      analyticsResource.addResource(route)
        .addMethod('GET', lambdaIntegration(analyticsLambda), authOptions);
    }

    this.apiUrl = this.api.url;

    // ── CloudFormation outputs ─────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl',           { value: this.api.url,                      exportName: `ApiUrl-${envName}` });
    new cdk.CfnOutput(this, 'ApiId',            { value: this.api.restApiId });
  }
}
