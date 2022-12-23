#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NelsonLoginProviderStack } from '../lib/nelson-login-provider-stack';
import * as config from 'config';

const app = new cdk.App();
new NelsonLoginProviderStack(app, 'LoginProvider', {
    env: {
        region: config.get('region'),
    }
});