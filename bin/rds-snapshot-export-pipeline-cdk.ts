#!/usr/bin/env node
import * as config from 'config';
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

import { RdsSnapshotExportPipelineStack } from '../lib/rds-snapshot-export-pipeline-stack';
const app = new cdk.App();

new RdsSnapshotExportPipelineStack(app, `${config.get('environmentname')}RdsSnapshotExportToS3Pipeline`);
