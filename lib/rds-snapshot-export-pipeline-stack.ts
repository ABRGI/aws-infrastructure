/*
* Code exports a snapshot of the nelson RDS to S3 bucket. Then clears legacy data from the RDS records.
  Ref: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-export-snapshot.html
*/
import { Database, DataFormat, Schema, Table } from '@aws-cdk/aws-glue-alpha';
import * as cdk from 'aws-cdk-lib';
import { CfnNamedQuery, CfnWorkGroup } from 'aws-cdk-lib/aws-athena';
import { CfnCrawler } from 'aws-cdk-lib/aws-glue';
import { AccountRootPrincipal, Effect, ManagedPolicy, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Code, Function, FunctionUrl, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { CfnEventSubscription } from 'aws-cdk-lib/aws-rds';
import { BlockPublicAccess, Bucket, EventType } from 'aws-cdk-lib/aws-s3';
import { SqsDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import * as config from 'config';
import { Construct } from 'constructs';
import * as path from 'path';
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
    const backupS3BucketName = `${dbName}-${config.get('rdssnapshotexportpipelinestack.snapshotbucket.namepostfix')}`;
    const resultBucketName = `${dbName}-${config.get('rdssnapshotexportpipelinestack.resultbucket.namepostfix')}`;
    const rdsSnapshotExportTaskRole = new Role(this, `${config.get('environmentname')}RdsSnapshotExportTaskRole`, {
      roleName: `${config.get<string>('environmentname').toLowerCase()}-rds-snapshot-export-task-role`,
      assumedBy: new ServicePrincipal("export.rds.amazonaws.com"),
      description: "Role used by RDS to perform snapshot exports to S3",
    });
    rdsSnapshotExportTaskRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));
    const lambdaExecutionRole = new Role(this, `${config.get('environmentname')}RdsSnapshotExporterLambdaExecutionRole`, {
      roleName: `${config.get<string>('environmentname').toLowerCase()}-rds-snapshot-exporter-lambda-execution-role`,
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
    const snapshotExportGlueCrawlerRole = new Role(this, `${config.get('environmentname')}SnapshotExportsGlueCrawlerRole`, {
      roleName: `${config.get<string>('environmentname').toLowerCase()}-snapshot-exports-glue-crawler-role`,
      assumedBy: new ServicePrincipal("glue.amazonaws.com"),
      description: "Role used by glue to perform data crawls from S3"
    });
    snapshotExportGlueCrawlerRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole"));
    const rdsSnapshotExportEncryptionKey = new Key(this, `${config.get('environmentname')}RdsSnapshotExportEncryptionKey`, {
      alias: `${config.get<string>('environmentname').toLowerCase()}-rds-snapshot-export-encryption-key`,
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
    const snapshotEventTopic = new Topic(this, `${config.get('environmentname')}SnapshotEventTopic`, {
      topicName: `${dbName}-rds-snapshot-creation`,
      displayName: `${dbName}-rds-snapshot-creation`,
    });
    const rdsSnapshotEventNotification = new CfnEventSubscription(this, `${config.get('environmentname')}RdsSnapshotEventNotification`, {
      subscriptionName: `${config.get<string>('environmentname').toLowerCase()}-rds-snapshot-event-notification`,
      snsTopicArn: snapshotEventTopic.topicArn,
      enabled: true,
      eventCategories: ['backup'],
      sourceType: 'db-cluster-snapshot',
    });
    const rdsSnapshotExporterLambdaFunction = new Function(this, `${config.get('environmentname')}RdsSnapshotExporterLambdaFunction`, {
      functionName: `${config.get<string>('environmentname').toLowerCase()}-rds-snapshot-exporter-lambda-function`,
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
    new FunctionUrl(this, `${config.get('environmentname')}RdsSnapshotExporterLambdaFunctionUrl`, {
      function: rdsSnapshotExporterLambdaFunction,
      authType: FunctionUrlAuthType.AWS_IAM
    });
    const backupBucket = new Bucket(this, `${config.get('environmentname')}RdsSnapshotExportBucket`, {
      bucketName: backupS3BucketName,
      removalPolicy: config.get('defaultremovalpolicy'),
      autoDeleteObjects: config.get('rdssnapshotexportpipelinestack.snapshotbucket.autoDeleteObjects'),
      publicReadAccess: config.get('rdssnapshotexportpipelinestack.snapshotbucket.publicreadaccess'),
      blockPublicAccess: new BlockPublicAccess({
        blockPublicAcls: config.get('rdssnapshotexportpipelinestack.snapshotbucket.blockpublicaccess.blockpublicacls'),
        blockPublicPolicy: config.get('rdssnapshotexportpipelinestack.snapshotbucket.blockpublicaccess.blockpublicpolicy'),
        ignorePublicAcls: config.get('rdssnapshotexportpipelinestack.snapshotbucket.blockpublicaccess.ignorepublicacls'),
        restrictPublicBuckets: config.get('rdssnapshotexportpipelinestack.snapshotbucket.blockpublicaccess.restrictpublicbuckets'),
      })
    });
    backupBucket.grantReadWrite(rdsSnapshotExportTaskRole);
    backupBucket.grantReadWrite(snapshotExportGlueCrawlerRole);
    const eventNotificationQueue = new Queue(this, `${config.get('environmentname')}EventNotificationQueue`, {
      queueName: `${backupS3BucketName}-enq`,
      removalPolicy: config.get('defaultremovalpolicy'),
    });
    backupBucket.addEventNotification(EventType.OBJECT_CREATED, new SqsDestination(eventNotificationQueue));
    const resultBucket = new Bucket(this, `${config.get('environmentname')}ResultBucket`, {
      bucketName: resultBucketName,
      removalPolicy: config.get('defaultremovalpolicy'),
      autoDeleteObjects: config.get('rdssnapshotexportpipelinestack.resultbucket.autoDeleteObjects'),
      publicReadAccess: config.get('rdssnapshotexportpipelinestack.resultbucket.publicreadaccess'),
      blockPublicAccess: new BlockPublicAccess({
        blockPublicAcls: config.get('rdssnapshotexportpipelinestack.resultbucket.blockpublicaccess.blockpublicacls'),
        blockPublicPolicy: config.get('rdssnapshotexportpipelinestack.resultbucket.blockpublicaccess.blockpublicpolicy'),
        ignorePublicAcls: config.get('rdssnapshotexportpipelinestack.resultbucket.blockpublicaccess.ignorepublicacls'),
        restrictPublicBuckets: config.get('rdssnapshotexportpipelinestack.resultbucket.blockpublicaccess.restrictpublicbuckets'),
      })
    });
    eventNotificationQueue.grantConsumeMessages(snapshotExportGlueCrawlerRole);
    eventNotificationQueue.grantPurge(snapshotExportGlueCrawlerRole);
    eventNotificationQueue.grantSendMessages(snapshotExportGlueCrawlerRole);
    // const snapshotExportCrawler = new CfnCrawler(this, `${config.get('environmentname')}SnapshotExportCrawler`, {
    //   name: `${dbName}-rds-snapshot-crawler`,
    //   role: snapshotExportGlueCrawlerRole.roleArn,
    //   targets: {
    //     s3Targets: [
    //       {
    //         path: backupBucket.bucketName,
    //         eventQueueArn: eventNotificationQueue.queueArn,
    //         exclusions: ['**/Unsaved/**']
    //       }
    //     ]
    //   },
    //   databaseName: dbName.replace(/[^a-zA-Z0-9_]/g, "_"),
    //   schemaChangePolicy: {
    //     deleteBehavior: 'DELETE_FROM_DATABASE'
    //   },
    //   schedule: {
    //     // run crawler everyday at 09:00 UTC
    //     scheduleExpression: "cron(0 9 * * ? *)"
    //   },
    //   recrawlPolicy: {
    //     // crawling only the changes identified by Amazon S3 events.
    //     recrawlBehavior: 'CRAWL_EVENT_MODE'
    //   }
    // });
    // snapshotExportCrawler.applyRemovalPolicy(config.get('defaultremovalpolicy'));
    const glueDatabase = new Database(this, `${config.get('environmentname')}GlueDataCatalogDatabase`, {
      databaseName: `${config.get<string>('environmentname').toLowerCase()}-glue-data-catalog-database`
    });
    glueDatabase.applyRemovalPolicy(config.get('defaultremovalpolicy'));
    // Create a Glue catalog table that references the Parquet files in the S3 bucket
    // For example: nelson_reservation
    const table = new Table(this, `${config.get('environmentname')}GlueDataCatalogNelsonReservationTable`, {
      database: glueDatabase,
      tableName: `${config.get<string>('environmentname').toLowerCase()}_nelson_reservation`,
      columns: [
        {
          name: 'id',
          type: Schema.BIG_INT
        },
        {
          name: 'version',
          type: Schema.INTEGER
        },
        {
          name: 'reservation_code',
          type: Schema.STRING
        },
        {
          name: 'uuid',
          type: Schema.STRING
        },
        {
          name: 'hotel_id',
          type: Schema.BIG_INT
        },
        {
          name: 'lang',
          type: Schema.STRING
        },
        {
          name: 'total_paid',
          type: Schema.STRING
        },
        {
          name: 'currency',
          type: Schema.STRING
        },
        {
          name: 'customer_first_name',
          type: Schema.STRING
        },
        {
          name: 'customer_last_name',
          type: Schema.STRING
        },
        {
          name: 'customer_mobile',
          type: Schema.STRING
        },
        {
          name: 'customer_address',
          type: Schema.STRING
        },
        {
          name: 'customer_postal_code',
          type: Schema.STRING
        },
        {
          name: 'customer_city',
          type: Schema.STRING
        },
        {
          name: 'customer_ssn',
          type: Schema.STRING
        },
        {
          name: 'customer_date_of_birth',
          type: Schema.STRING
        },
        {
          name: 'customer_purpose_of_visit',
          type: Schema.STRING
        },
        {
          name: 'customer_nationality',
          type: Schema.STRING
        },
        {
          name: 'company_name',
          type: Schema.STRING
        },
        {
          name: 'company_reference',
          type: Schema.STRING
        },
        {
          name: 'booking_channel',
          type: Schema.STRING
        },
        {
          name: 'booking_channel_reservation_id',
          type: Schema.STRING
        },
        {
          name: 'check_in',
          type: Schema.STRING
        },
        {
          name: 'check_out',
          type: Schema.STRING
        },
        {
          name: 'created',
          type: Schema.STRING
        },
        {
          name: 'confirmed',
          type: Schema.STRING
        },
        {
          name: 'cancelled',
          type: Schema.STRING
        },
        {
          name: 'is_fully_refunded',
          type: Schema.BOOLEAN
        },
        {
          name: 'pending_confirmation_since',
          type: Schema.STRING
        },
        {
          name: 'change_type',
          type: Schema.STRING
        },
        {
          name: 'state',
          type: Schema.STRING
        },
        {
          name: 'notify_customer',
          type: Schema.BOOLEAN
        },
        {
          name: 'is_overrided',
          type: Schema.BOOLEAN
        },
        {
          name: 'type',
          type: Schema.INTEGER
        },
        {
          name: 'modified_by',
          type: Schema.STRING
        },
        {
          name: 'marketing_permission',
          type: Schema.BOOLEAN
        },
        {
          name: 'customer_email_real',
          type: Schema.STRING
        },
        {
          name: 'customer_email_virtual',
          type: Schema.STRING
        },
        {
          name: 'total_paid_extra_for_ota',
          type: Schema.STRING
        },
        {
          name: 'breakfasts_for_all',
          type: Schema.BOOLEAN
        },
        {
          name: 'company_y_tunnus',
          type: Schema.STRING
        },
        {
          name: 'customer_passport_number',
          type: Schema.STRING
        },
        {
          name: 'member_id',
          type: Schema.BIG_INT
        },
        {
          name: 'customer_iso_country_code',
          type: Schema.STRING
        },
        {
          name: 'cancellation_reason',
          type: Schema.STRING
        }
      ],
      dataFormat: DataFormat.PARQUET,
      storedAsSubDirectories: true,
      bucket: backupBucket,
      s3Prefix: '/dev-saas-nelson-service-2023-02-17/nelson/nelson.reservation/'
    });
    table.applyRemovalPolicy(config.get('defaultremovalpolicy'));
    const cfnWorkGroup = new CfnWorkGroup(this, `${config.get('environmentname')}CfnWorkGroup`, {
      name: `${config.get<string>('environmentname').toLowerCase()}_etl_wgp`,
      description: `ETL Workgroup`,
      state: 'ENABLED',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${ resultBucket.bucketName }/output/`
        }
      }
    });
    cfnWorkGroup.applyRemovalPolicy(config.get('defaultremovalpolicy'));
    // Create an Athena table that references the Glue catalog table
    const athenaTable = new CfnNamedQuery(this, `${config.get('environmentname')}MyAthenaTable`, {
      name: `all_data_from table ${ table.tableName }`,
      database: glueDatabase.databaseName,
      queryString: `SELECT * FROM "${table.tableName}"`,
      description: 'A sample Athena query',
      workGroup: cfnWorkGroup.name
    });
    athenaTable.applyRemovalPolicy(config.get('defaultremovalpolicy'));
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
    // cdk.Aspects.of(snapshotExportCrawler).add(
    //   new cdk.Tag('nelson:client', `saas`)
    // );
    // cdk.Aspects.of(snapshotExportCrawler).add(
    //   new cdk.Tag('nelson:role', `rds-export-service`)
    // );
    // cdk.Aspects.of(snapshotExportCrawler).add(
    //   new cdk.Tag('nelson:environment', config.get('environmentname'))
    // );
    cdk.Aspects.of(eventNotificationQueue).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(eventNotificationQueue).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(eventNotificationQueue).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
    cdk.Aspects.of(rdsSnapshotEventNotification).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(rdsSnapshotEventNotification).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(rdsSnapshotEventNotification).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
    cdk.Aspects.of(snapshotEventTopic).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(snapshotEventTopic).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(snapshotEventTopic).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
    cdk.Aspects.of(glueDatabase).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(glueDatabase).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(glueDatabase).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
    cdk.Aspects.of(table).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(table).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(table).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
    cdk.Aspects.of(athenaTable).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(athenaTable).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(athenaTable).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
    cdk.Aspects.of(cfnWorkGroup).add(
      new cdk.Tag('nelson:client', `saas`)
    );
    cdk.Aspects.of(cfnWorkGroup).add(
      new cdk.Tag('nelson:role', `rds-export-service`)
    );
    cdk.Aspects.of(cfnWorkGroup).add(
      new cdk.Tag('nelson:environment', config.get('environmentname'))
    );
  }
}