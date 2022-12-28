#!/usr/bin/env node
/*
    App script creates the user management service for Nelson. This includes the different stacks required to create
    - Cognito user pool
    - User management service functions and api gateway
    - Dynamo DB tables
    - Cloudfront distribution
    - Route53 Hosted Zone and record

    Dependencies:
    Script needs to be run for a common AWS account.
    Remember to bootstrap execution region + N. Virginia (us-east-1)
*/
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NelsonLoginProviderStack } from '../lib/nelson-login-provider-stack';
import { NelsonUserManagementServiceStack } from '../lib/nelson-user-management-service-stack';
import * as config from 'config';
import { NelsonManagementHostedZoneStack } from '../lib/nelson-management-hosted-zone-stack';
import { NelsonManagementCloudFrontStack } from '../lib/nelson-management-cloudfront-stack';

const app = new cdk.App();
const hostedZoneStack = new NelsonManagementHostedZoneStack(app, `${config.get('environmentname')}HostedZoneStack`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1' //Certificate of the hosted zone needs to be in N. Virginia. Hosted zones are global anyway
    }
});
const userManagementServiceStack = new NelsonUserManagementServiceStack(app, `${config.get('environmentname')}UserManagementService`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    }
});
new NelsonLoginProviderStack(app, `${config.get('environmentname')}LoginProvider`, {
    env: {
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    }
});
const apiGatewayRestApiId = userManagementServiceStack.userManagementServiceApiGw.restApiId.toString();
const apiGatewayRegion = userManagementServiceStack.region.toString();
new NelsonManagementCloudFrontStack(app, `${config.get('environmentname')}NelsonManagementCloudFrontDistribution`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    hostedZone: hostedZoneStack.hostedZone,
    viewerAcmCertificateArn: hostedZoneStack.domainCertificate.certificateArn,
    apiGatewayRestApiId: apiGatewayRestApiId,
    apiGatewayRegion: apiGatewayRegion,
    crossRegionReferences: true
});