#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NelsonLoginProviderStack } from '../lib/nelson-login-provider-stack';
import { NelsonUserManagementServiceStack } from '../lib/nelson-user-management-service-stack';
import * as config from 'config';

const app = new cdk.App();
new NelsonUserManagementServiceStack(app, `${config.get('environmentname')}UserManagementService`, {
    env: {
        region: config.get('awsregion')
    }
});
new NelsonLoginProviderStack(app, `${config.get('environmentname')}LoginProvider`, {
    env: {
        region: config.get('awsregion')
    }
});