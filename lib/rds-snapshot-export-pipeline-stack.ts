import * as cdk from 'aws-cdk-lib';
import * as config from 'config';
import { Construct } from 'constructs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { AccountRootPrincipal, ManagedPolicy, PolicyDocument, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Code, FunctionUrl, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import path = require('path');
import * as lambda from 'aws-cdk-lib/aws-lambda';

export enum RdsEventId {
  /**
   * Event IDs for which the Lambda supports starting a snapshot export task.
   *
   * See:
   *   https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_Events.Messages.html#USER_Events.Messages.cluster-snapshot
   *   https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_Events.Messages.html#USER_Events.Messages.snapshot
   */
  // For automated snapshots of Aurora RDS clusters
  DB_AUTOMATED_AURORA_SNAPSHOT_CREATED = "RDS-EVENT-0169",

  // For automated snapshots of non-Aurora RDS clusters
  DB_AUTOMATED_SNAPSHOT_CREATED = "RDS-EVENT-0091"
}

export interface RdsSnapshotExportPipelineStackProps extends cdk.StackProps {
  /**
   * Name of the S3 bucket to which snapshot exports should be saved.
   *
   * NOTE: Bucket will be created if one does not already exist.
   */
  readonly s3BucketName: string;

  /**
   * Name of the database cluster whose snapshots the function supports exporting.
   */
  readonly dbName: string;
};

export class RdsSnapshotExportPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RdsSnapshotExportPipelineStackProps) {
    super(scope, id, props);

    const bucket = new Bucket(this, "SnapshotExportBucket", {
      bucketName: props.s3BucketName,
      removalPolicy: config.get('defaultremovalpolicy'),
      autoDeleteObjects: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    const snapshotExportTaskRole = new Role(this, "SnapshotExportTaskRole", {
      assumedBy: new ServicePrincipal("export.rds.amazonaws.com"),
      description: "Role used by RDS to perform snapshot exports to S3",
      inlinePolicies: {
        "SnapshotExportTaskPolicy": PolicyDocument.fromJson({
          "Version": "2012-10-17",
          "Statement": [
            {
              "Action": [
                "s3:PutObject*",
                "s3:ListBucket",
                "s3:GetObject*",
                "s3:DeleteObject*",
                "s3:GetBucketLocation"
              ],
              "Resource": [
                `${bucket.bucketArn}`,
                `${bucket.bucketArn}/*`,
              ],
              "Effect": "Allow"
            }
          ],
        })
      }
    });

    const lambdaExecutionRole = new Role(this, "RdsSnapshotExporterLambdaExecutionRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description: 'RdsSnapshotExportToS3 Lambda execution role for the "' + props.dbName + '" database.',
      inlinePolicies: {
        "SnapshotExporterLambdaPolicy": PolicyDocument.fromJson({
          "Version": "2012-10-17",
          "Statement": [
            {
              "Action": "rds:StartExportTask",
              "Resource": "*",
              "Effect": "Allow",
            },
            {
              "Action": "iam:PassRole",
              "Resource": [snapshotExportTaskRole.roleArn],
              "Effect": "Allow",
            }
          ]
        })
      },
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    const snapshotExportEncryptionKey = new Key(this, "SnapshotExportEncryptionKey", {
      alias: props.dbName + "-snapshot-exports",
      policy: PolicyDocument.fromJson({
        "Version": "2012-10-17",
        "Statement": [
          {
            "Principal": {
              "AWS": [
                (new AccountRootPrincipal()).arn,
                lambdaExecutionRole.roleArn
              ]
            },
            "Action": [
              "kms:Encrypt",
              "kms:Decrypt",
              "kms:ReEncrypt*",
              "kms:GenerateDataKey*",
              "kms:DescribeKey"
            ],
            "Resource": "*",
            "Effect": "Allow",
          },
          {
            "Principal": { "AWS": lambdaExecutionRole.roleArn },
            "Action": [
              "kms:CreateGrant",
              "kms:ListGrants",
              "kms:RevokeGrant"
            ],
            "Resource": "*",
            "Condition": {
                "Bool": {"kms:GrantIsForAWSResource": true}
            },
            "Effect": "Allow",
          },
          {
            "Principal": { "AWS": (new AccountRootPrincipal()).arn },
            "Action": [
              "kms:CancelKeyDeletion",
              "kms:Create*",
              "kms:Delete*",
              "kms:Describe*",
              "kms:Disable*",
              "kms:Enable*",
              "kms:GenerateDataKey",
              "kms:Get*",
              "kms:List*",
              "kms:Put*",
              "kms:Revoke*",
              "kms:ScheduleKeyDeletion",
              "kms:TagResource",
              "kms:UntagResource",
              "kms:Update*"
            ],
            "Resource": "*",
            "Effect": "Allow",
          }
        ]
      })
    });

    const lambdaFunction = new lambda.Function(this, "LambdaFunction", {
      functionName: props.dbName + "-rds-snapshot-exporter",
      runtime: Runtime.PYTHON_3_8,
      handler: "main.handler",
      code: Code.fromAsset(path.join(__dirname, "/../assets/exporter/")),
      environment: {
        LOG_LEVEL: "INFO",
        DB_NAME: props.dbName,
        SNAPSHOT_BUCKET_NAME: bucket.bucketName,
        SNAPSHOT_TASK_ROLE: snapshotExportTaskRole.roleArn,
        SNAPSHOT_TASK_KEY: snapshotExportEncryptionKey.keyArn
      },
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30)
    });

    const functionUrl = new FunctionUrl(this, "FunctionUrl", {
      function: lambdaFunction,
      authType: FunctionUrlAuthType.AWS_IAM
    })
    
  }
}
