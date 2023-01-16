/*
* Code exports a snapshot of the nelson RDS to S3 bucket. Then clears legacy data from the RDS records.
  Ref: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-export-snapshot.html
*/

import * as cdk from 'aws-cdk-lib';
import * as config from 'config';
import { Construct } from 'constructs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { AccountRootPrincipal, ManagedPolicy, PolicyDocument, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Code, FunctionUrl, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

const accountRootPrincipal = new AccountRootPrincipal();
export class RdsSnapshotExportPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dbName = `${config.get('environmentname')}-${config.get('rdssnapshotexportpipelinestack.databasename')}`;
    const backupS3BucketName = `${dbName}-${config.get('rdssnapshotexportpipelinestack.bucketnamepostfix')}`;

    const rdsSnapshotExportTaskRole = new Role(this, "RdsSnapshotExportTaskRole", {
      roleName: `${config.get('environmentname')}RdsSnapshotExportTaskRole`,
      assumedBy: new ServicePrincipal("export.rds.amazonaws.com"),
      description: "Role used by RDS to perform snapshot exports to S3",
    });

    const lambdaExecutionRole = new Role(this, "RdsSnapshotExporterLambdaExecutionRole", {
      roleName: `${config.get('environmentname')}RdsSnapshotExporterLambdaExecutionRole`,
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description: 'RdsSnapshotExportToS3 Lambda execution role',
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
              "Resource": [rdsSnapshotExportTaskRole.roleArn],
              "Effect": "Allow",
            }
          ]
        })
      },
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });
    
    const rdsSnapshotExportEncryptionKey = new Key(this, "RdsSnapshotExportEncryptionKey", {
      alias: `${config.get('environmentname')}-rds-snapshot-export-encryption-key`.toLowerCase(),
      policy: PolicyDocument.fromJson({
        "Version": "2012-10-17",
        "Statement": [
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
          }
        ]
      })
    });

    rdsSnapshotExportEncryptionKey.grantAdmin(accountRootPrincipal);
    rdsSnapshotExportEncryptionKey.grantEncryptDecrypt(accountRootPrincipal);
    rdsSnapshotExportEncryptionKey.grantEncryptDecrypt(lambdaExecutionRole);

    const rdsSnapshotExporterLambdaFunction = new lambda.Function(this, "RdsSnapshotExporterLambdaFunction", {
      functionName: `${config.get('environmentname')}RdsSnapshotExporterLambdaFunction`,
      runtime: Runtime.PYTHON_3_8,
      handler: "main.handler",
      code: Code.fromAsset(path.join(__dirname, "/../assets/exporter/")),
      environment: {
        LOG_LEVEL: "INFO",
        SNAPSHOT_TASK_ROLE: rdsSnapshotExportTaskRole.roleArn,
        SNAPSHOT_TASK_KEY: rdsSnapshotExportEncryptionKey.keyArn
      },
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30)
    });
    
    const rdsSnapshotExporterLambdaFunctionUrl = new FunctionUrl(this, "rdsSnapshotExporterLambdaFunctionUrl", {
      function: rdsSnapshotExporterLambdaFunction,
      authType: FunctionUrlAuthType.AWS_IAM
    })

    const bucket = new Bucket(this, "RdsSnapshotExportBucket", {
      bucketName: backupS3BucketName,
      removalPolicy: config.get('defaultremovalpolicy'),
      autoDeleteObjects: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    bucket.grantReadWrite(rdsSnapshotExportTaskRole);
  }
}
