#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RdsSnapshotExportPipelineStack, RdsEventId } from '../lib/rds-snapshot-export-pipeline-stack';
import config = require('config');

const app = new cdk.App();
new RdsSnapshotExportPipelineStack(app, 'RdsSnapshotExportToS3Pipeline', {
  dbName: `${config.get('rds.database.name')}`,
  rdsEventId: RdsEventId.DB_AUTOMATED_AURORA_SNAPSHOT_CREATED,
  s3BucketName: `${config.get('bucket.name')}`,
});
