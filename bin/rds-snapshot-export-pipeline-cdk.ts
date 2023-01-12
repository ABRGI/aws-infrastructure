#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RdsSnapshotExportPipelineStack } from '../lib/rds-snapshot-export-pipeline-stack';
import config = require('config');

const app = new cdk.App();
const dbName = `${config.get('environmentname')}-${config.get('databasename')}`.toLowerCase();
const s3BucketName = `${dbName}-${config.get('rdssnapshotexportpipelinestack.bucketname')}`.toLowerCase();

new RdsSnapshotExportPipelineStack(app, `${config.get('environmentname')}RdsSnapshotExportToS3Pipeline`, {
  dbName: dbName,
  s3BucketName: s3BucketName
});
