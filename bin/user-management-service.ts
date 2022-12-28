#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NelsonLoginProviderStack } from '../lib/nelson-login-provider-stack';
import { NelsonUserManagementServiceStack } from '../lib/nelson-user-management-service-stack';
import * as config from 'config';
import { NelsonManagementHostedZoneStack } from '../lib/nelson-management-hosted-zone-stack';

const app = new cdk.App();
new NelsonManagementHostedZoneStack(app, `${config.get('environmentname')}HostedZoneStack`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION

    }
});
new NelsonUserManagementServiceStack(app, `${config.get('environmentname')}UserManagementService`, {
    env: {
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION

    }
});
new NelsonLoginProviderStack(app, `${config.get('environmentname')}LoginProvider`, {
    env: {
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    }
});