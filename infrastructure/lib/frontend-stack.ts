import * as cdk from 'aws-cdk-lib';

import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import { Construct } from 'constructs';

import * as path from 'path';
import * as fs from 'fs';

interface FrontendStackProps extends cdk.StackProps {
  envName: string;
  apiUrl: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly distributionUrl: string;
  public readonly distributionId: string;

  constructor(
    scope: Construct,
    id: string,
    props: FrontendStackProps
  ) {
    super(scope, id, props);

    const {
      envName,
      apiUrl,
    } = props;

    // ================================================================
    // LAMBDA ROOT
    // ================================================================

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
    // ================================================================

    const sharedLayer = new lambda.LayerVersion(
      this,
      'ApiSharedLayer',
      {
        layerVersionName:
          `invoice-api-shared-${envName}`,

        code: lambda.Code.fromAsset(
          path.join(
            lambdaRoot,
            'shared'
          ),
          {
            bundling: {
              // ------------------------------------------------------
              // Docker bundling
              // ------------------------------------------------------

              image:
                lambda.Runtime.PYTHON_3_12.bundlingImage,

              command: [
                'bash',
                '-c',
                [
                  'mkdir -p /asset-output/python',

                  // Install dependencies
                  'if [ -f /asset-input/requirements.txt ]; then pip install -r /asset-input/requirements.txt -t /asset-output/python --quiet; fi',

                  // Copy Python source files
                  'cp -r /asset-input/*.py /asset-output/python/ 2>/dev/null || true',
                ].join(' && '),
              ],

              // ------------------------------------------------------
              // Local bundling
              // ------------------------------------------------------

              local: {
                tryBundle(
                  outputDir: string
                ): boolean {
                  const {
                    execSync,
                  } = require(
                    'child_process'
                  );

                  const fs = require(
                    'fs'
                  );

                  const srcDir =
                    path.join(
                      lambdaRoot,
                      'shared'
                    );

                  const destDir =
                    path.join(
                      outputDir,
                      'python'
                    );

                  fs.mkdirSync(
                    destDir,
                    {
                      recursive: true,
                    }
                  );

                  // ------------------------------------------------
                  // Install Python dependencies
                  // ------------------------------------------------

                  const requirementsFile =
                    path.join(
                      srcDir,
                      'requirements.txt'
                    );

                  if (
                    fs.existsSync(
                      requirementsFile
                    )
                  ) {
                    console.log(
                      'Installing shared Lambda dependencies...'
                    );

                    execSync(
                      `pip install -r "${requirementsFile}" -t "${destDir}" --quiet`,
                      {
                        stdio:
                          'inherit',
                      }
                    );
                  }

                  // ------------------------------------------------
                  // Copy Python source files
                  // ------------------------------------------------

                  for (
                    const file of fs.readdirSync(
                      srcDir
                    )
                  ) {
                    const source =
                      path.join(
                        srcDir,
                        file
                      );

                    const destination =
                      path.join(
                        destDir,
                        file
                      );

                    if (
                      fs
                        .statSync(
                          source
                        )
                        .isFile() &&
                      file.endsWith(
                        '.py'
                      )
                    ) {
                      fs.copyFileSync(
                        source,
                        destination
                      );
                    }
                  }

                  return true;
                },
              },
            },
          }
        ),

        // Lambda runtime compatibility
        compatibleRuntimes: [
          lambda.Runtime.PYTHON_3_12,
        ],

        // Your Lambda functions are ARM64
        compatibleArchitectures: [
          lambda.Architecture.ARM_64,
        ],

        description:
          'Shared utilities and dependencies for Invoice API Lambda functions',
      }
    );

    // ================================================================
    // S3 BUCKET FOR FRONTEND
    // ================================================================

    const frontendBucket =
      new s3.Bucket(
        this,
        'FrontendHostingBucket',
        {
          bucketName:
            `invoice-frontend-hosting-${envName}-${this.account}`,

          blockPublicAccess:
            s3.BlockPublicAccess.BLOCK_ALL,

          removalPolicy:
            envName === 'prod'
              ? cdk.RemovalPolicy.RETAIN
              : cdk.RemovalPolicy.DESTROY,

          autoDeleteObjects:
            envName !== 'prod',
        }
      );

    // ================================================================
    // CLOUDFRONT DISTRIBUTION
    // ================================================================

    const distribution =
      new cloudfront.Distribution(
        this,
        'Distribution',
        {
          comment:
            `Invoice Intelligence Platform — ${envName}`,

          defaultBehavior: {
            origin:
              cloudfront_origins
                .S3BucketOrigin
                .withOriginAccessControl(
                  frontendBucket
                ),

            viewerProtocolPolicy:
              cloudfront
                .ViewerProtocolPolicy
                .REDIRECT_TO_HTTPS,

            cachePolicy:
              cloudfront
                .CachePolicy
                .CACHING_OPTIMIZED,

            allowedMethods:
              cloudfront
                .AllowedMethods
                .ALLOW_GET_HEAD_OPTIONS,

            compress: true,
          },

          defaultRootObject:
            'index.html',

          // ========================================================
          // SPA ROUTING
          // ========================================================

          errorResponses: [
            {
              httpStatus: 404,

              responseHttpStatus: 200,

              responsePagePath:
                '/index.html',

              ttl:
                cdk.Duration.seconds(
                  0
                ),
            },

            {
              httpStatus: 403,

              responseHttpStatus: 200,

              responsePagePath:
                '/index.html',

              ttl:
                cdk.Duration.seconds(
                  0
                ),
            },
          ],

          // Cheapest CloudFront price class
          priceClass:
            cloudfront.PriceClass
              .PRICE_CLASS_100,
        }
      );

    // ================================================================
    // DISTRIBUTION OUTPUT VALUES
    // ================================================================

    this.distributionUrl =
      `https://${distribution.distributionDomainName}`;

    this.distributionId =
      distribution.distributionId;

    // ================================================================
    // DEPLOY REACT FRONTEND
    // ================================================================

    const distPath =
      path.join(
        __dirname,
        '../../frontend/dist'
      );

    if (
      fs.existsSync(
        distPath
      )
    ) {
      new s3deploy.BucketDeployment(
        this,
        'DeployFrontend',
        {
          sources: [
            s3deploy.Source.asset(
              distPath
            ),
          ],

          destinationBucket:
            frontendBucket,

          distribution,

          distributionPaths: [
            '/*',
          ],

          cacheControl: [
            // Vite hashed assets can be cached for a long time
            s3deploy.CacheControl
              .maxAge(
                cdk.Duration.days(
                  365
                )
              ),

            s3deploy.CacheControl
              .sMaxAge(
                cdk.Duration.days(
                  365
                )
              ),
          ],
        }
      );
    } else {
      new cdk.CfnOutput(
        this,
        'FrontendDeployNote',
        {
          value:
            'Run: cd frontend && npm run build — then redeploy this stack',
        }
      );
    }

    // ================================================================
    // CLOUDFORMATION OUTPUTS
    // ================================================================

    new cdk.CfnOutput(
      this,
      'CloudFrontUrl',
      {
        value:
          this.distributionUrl,

        exportName:
          `CloudFrontUrl-${envName}`,
      }
    );

    new cdk.CfnOutput(
      this,
      'DistributionId',
      {
        value:
          this.distributionId,

        exportName:
          `DistributionId-${envName}`,
      }
    );

    new cdk.CfnOutput(
      this,
      'FrontendBucketName',
      {
        value:
          frontendBucket.bucketName,
      }
    );

    new cdk.CfnOutput(
      this,
      'ApiUrlPassthrough',
      {
        value:
          apiUrl,
      }
    );

    // ================================================================
    // SHARED LAYER OUTPUT
    // ================================================================

    new cdk.CfnOutput(
      this,
      'ApiSharedLayerArn',
      {
        value:
          sharedLayer.layerVersionArn,
      }
    );
  }
}