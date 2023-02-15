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
import { Topic } from 'aws-cdk-lib/aws-sns';
import { CfnEventSubscription } from 'aws-cdk-lib/aws-rds';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { CfnCrawler } from 'aws-cdk-lib/aws-glue';
const accountRootPrincipal = new AccountRootPrincipal();
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
export class RdsSnapshotExportPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const dbName = `${config.get('rdssnapshotexportpipelinestack.databasename')}`;
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
    const snapshotExportGlueCrawlerRole = new Role(this, "SnapshotExportsGlueCrawlerRole", {
      assumedBy: new ServicePrincipal("glue.amazonaws.com"),
      description: "Role used by glue to perform data crawls from S3"
    });
    snapshotExportGlueCrawlerRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole"));
    const rdsSnapshotExportEncryptionKey = new Key(this, "RdsSnapshotExportEncryptionKey", {
      alias: `${config.get('environmentname')}-rds-snapshot-export-encryption-key`.toLowerCase(),
      removalPolicy: config.get('defaultremovalpolicy')
    });
    rdsSnapshotExportEncryptionKey.grantEncryptDecrypt(accountRootPrincipal);
    rdsSnapshotExportEncryptionKey.grantAdmin(lambdaExecutionRole);
    rdsSnapshotExportEncryptionKey.grantEncryptDecrypt(lambdaExecutionRole);
    rdsSnapshotExportEncryptionKey.grantEncryptDecrypt(snapshotExportGlueCrawlerRole);
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
    const snapshotEventTopic = new Topic(this, "SnapshotEventTopic", {
      displayName: "rds-snapshot-creation"
    });
    new CfnEventSubscription(this, 'RdsSnapshotEventNotification', {
      snsTopicArn: snapshotEventTopic.topicArn,
      enabled: true,
      eventCategories: ['backup'],
      sourceType: 'db-cluster-snapshot',
    });
    const rdsSnapshotExporterLambdaFunction = new lambda.Function(this, "RdsSnapshotExporterLambdaFunction", {
      functionName: `${config.get('environmentname')}RdsSnapshotExporterLambdaFunction`,
      runtime: Runtime.PYTHON_3_8,
      handler: "main.handler",
      code: Code.fromAsset(path.join(__dirname, "/../assets/exporter/")),
      environment: {
        RDS_EVENT_ID: RdsEventId.DB_AUTOMATED_AURORA_SNAPSHOT_CREATED,
        DB_NAME: dbName,
        LOG_LEVEL: "DEBUG",
        SNAPSHOT_BUCKET_NAME: backupS3BucketName,
        SNAPSHOT_TASK_ROLE: rdsSnapshotExportTaskRole.roleArn,
        SNAPSHOT_TASK_KEY: rdsSnapshotExportEncryptionKey.keyArn,
        DB_SNAPSHOT_TYPE: "cluster-snapshot",
      },
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      events: [
        new SnsEventSource(snapshotEventTopic)
      ]
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
    backupBucket.grantReadWrite(snapshotExportGlueCrawlerRole);
    const eventNotificationQueue = new cdk.aws_sqs.Queue(this, `${config.get('environmentname')}EventNotificationQueue`, {
      queueName: `${ backupS3BucketName }-enq`,
      removalPolicy: config.get('defaultremovalpolicy')
    });
    backupBucket.addEventNotification(cdk.aws_s3.EventType.OBJECT_CREATED, new cdk.aws_s3_notifications.SqsDestination(eventNotificationQueue));
    eventNotificationQueue.grantConsumeMessages(snapshotExportGlueCrawlerRole);
    eventNotificationQueue.grantPurge(snapshotExportGlueCrawlerRole);
    const snapshotExportCrawler = new CfnCrawler(this, "SnapshotExportCrawler", {
      name: `${dbName}-rds-snapshot-crawler`,
      role: snapshotExportGlueCrawlerRole.roleArn,
      targets: {
        s3Targets: [
          {
            path: backupBucket.bucketName,
            eventQueueArn: eventNotificationQueue.queueArn
          }
        ]
      },
      databaseName: dbName.replace(/[^a-zA-Z0-9_]/g, "_"),
      schemaChangePolicy: {
        deleteBehavior: 'DELETE_FROM_DATABASE'
      },
      schedule: {
        // run crawler everyday at 09:00 UTC
        scheduleExpression: "cron(0 9 * * ? *)"
      },
      recrawlPolicy: {
        // crawling only the changes identified by Amazon S3 events.
        recrawlBehavior: 'CRAWL_EVENT_MODE'
      }
    });
    snapshotExportCrawler.applyRemovalPolicy(config.get('defaultremovalpolicy'));
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
    cdk.Aspects.of(snapshotExportCrawler).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(snapshotExportCrawler).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(snapshotExportCrawler).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
  }
}
