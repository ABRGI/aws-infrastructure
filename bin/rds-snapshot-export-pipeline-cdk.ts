#!/usr/bin/env node
import * as config from 'config';
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

import { RdsSnapshotExportPipelineStack } from '../lib/rds-snapshot-export-pipeline-stack';
const app = new cdk.App();
const environmentName = `${config.get('environmentname')}`;
const dbName = `${environmentName}-${config.get('databasename')}`.toLowerCase();
const s3BucketName = `${dbName}-${config.get('rdssnapshotexportpipelinestack.bucketnamepostfix')}`.toLowerCase();

new RdsSnapshotExportPipelineStack(app, `${config.get('environmentname')}RdsSnapshotExportToS3Pipeline`, {
  environmentName: environmentName,
  dbName: dbName,
  s3BucketName: s3BucketName
});
