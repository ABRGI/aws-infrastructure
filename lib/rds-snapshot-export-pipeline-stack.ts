/*
* Code exports a snapshot of the nelson RDS to S3 bucket. Then clears legacy data from the RDS records.
  Ref: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-export-snapshot.html
*/

import * as cdk from 'aws-cdk-lib';
import * as config from 'config';
import { Construct } from 'constructs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { AccountRootPrincipal, Effect, ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Code, FunctionUrl, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { Action } from 'aws-cdk-lib/aws-codepipeline';

const accountRootPrincipal = new AccountRootPrincipal();
export class RdsSnapshotExportPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const dbName = `${String(config.get('environmentname')).toLowerCase()}-${config.get('rdssnapshotexportpipelinestack.databasename')}`;
    const backupS3BucketName = `${dbName}-${config.get('rdssnapshotexportpipelinestack.bucket.namepostfix')}`;
    const rdsSnapshotExportTaskRole = new Role(this, "RdsSnapshotExportTaskRole", {
      roleName: `${config.get('environmentname')}RdsSnapshotExportTaskRole`,
      assumedBy: new ServicePrincipal("export.rds.amazonaws.com"),
      description: "Role used by RDS to perform snapshot exports to S3",
    });
    rdsSnapshotExportTaskRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));
    const lambdaExecutionRole = new Role(this, "RdsSnapshotExporterLambdaExecutionRole", {
      roleName: `${config.get('environmentname')}RdsSnapshotExporterLambdaExecutionRole`,
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description: 'RdsSnapshotExportToS3 Lambda execution role'
    });
    lambdaExecutionRole.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["rds:StartExportTask"],
      resources: ["*"]
    }));
    lambdaExecutionRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
    lambdaExecutionRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));
    rdsSnapshotExportTaskRole.grantPassRole(lambdaExecutionRole);
    const rdsSnapshotExportEncryptionKey = new Key(this, "RdsSnapshotExportEncryptionKey", {
      alias: `${config.get('environmentname')}-rds-snapshot-export-encryption-key`.toLowerCase(),
      removalPolicy: config.get('defaultremovalpolicy')
    });
    rdsSnapshotExportEncryptionKey.grantEncryptDecrypt(accountRootPrincipal);
    rdsSnapshotExportEncryptionKey.grantAdmin(lambdaExecutionRole);
    rdsSnapshotExportEncryptionKey.grantEncryptDecrypt(lambdaExecutionRole);
    rdsSnapshotExportEncryptionKey.addToResourcePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [lambdaExecutionRole],
      actions: [
        "kms:CreateGrant",
        "kms:ListGrants",
        "kms:RevokeGrant"
      ],
      conditions: {
        "Bool": { "kms:GrantIsForAWSResource": true }
      },
      resources: ['*']
    }));
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
    rdsSnapshotExporterLambdaFunction.applyRemovalPolicy(config.get('defaultremovalpolicy'));
    new FunctionUrl(this, "rdsSnapshotExporterLambdaFunctionUrl", {
      function: rdsSnapshotExporterLambdaFunction,
      authType: FunctionUrlAuthType.AWS_IAM
    });
    const backupBucket = new Bucket(this, "RdsSnapshotExportBucket", {
      bucketName: backupS3BucketName,
      removalPolicy: config.get('defaultremovalpolicy'),
      autoDeleteObjects: config.get('rdssnapshotexportpipelinestack.bucket.autoDeleteObjects'),
      publicReadAccess: config.get('rdssnapshotexportpipelinestack.bucket.publicreadaccess'),
      blockPublicAccess: new BlockPublicAccess({
        blockPublicAcls: config.get('rdssnapshotexportpipelinestack.bucket.blockpublicaccess.blockpublicacls'),
        blockPublicPolicy: config.get('rdssnapshotexportpipelinestack.bucket.blockpublicaccess.blockpublicpolicy'),
        ignorePublicAcls: config.get('rdssnapshotexportpipelinestack.bucket.blockpublicaccess.ignorepublicacls'),
        restrictPublicBuckets: config.get('rdssnapshotexportpipelinestack.bucket.blockpublicaccess.restrictpublicbuckets'),
      })
    });
    backupBucket.grantReadWrite(rdsSnapshotExportTaskRole);
    cdk.Aspects.of(rdsSnapshotExportEncryptionKey).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(rdsSnapshotExportEncryptionKey).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(rdsSnapshotExportEncryptionKey).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
    cdk.Aspects.of(rdsSnapshotExporterLambdaFunction).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(rdsSnapshotExporterLambdaFunction).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(rdsSnapshotExporterLambdaFunction).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
    cdk.Aspects.of(backupBucket).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(backupBucket).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(backupBucket).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
  }
}
