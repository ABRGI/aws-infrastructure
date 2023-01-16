import * as cdk from 'aws-cdk-lib';
import * as config from 'config';
import { Construct } from 'constructs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { AccountRootPrincipal, ManagedPolicy, PolicyDocument, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Code, FunctionUrl, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
export interface RdsSnapshotExportPipelineStackProps extends cdk.StackProps {
  readonly environmentName: string
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

const accountRootPrincipal = new AccountRootPrincipal();
export class RdsSnapshotExportPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RdsSnapshotExportPipelineStackProps) {
    super(scope, id, props);

    const rdsSnapshotExportTaskRole = new Role(this, "RdsSnapshotExportTaskRole", {
      roleName: `${props.environmentName}RdsSnapshotExportTaskRole`,
      assumedBy: new ServicePrincipal("export.rds.amazonaws.com"),
      description: "Role used by RDS to perform snapshot exports to S3",
    });

    const lambdaExecutionRole = new Role(this, "RdsSnapshotExporterLambdaExecutionRole", {
      roleName: `${props.environmentName}RdsSnapshotExporterLambdaExecutionRole`,
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
      bucketName: props.s3BucketName,
      removalPolicy: config.get('defaultremovalpolicy'),
      autoDeleteObjects: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    bucket.grantReadWrite(rdsSnapshotExportTaskRole);
  }
}
