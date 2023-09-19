#!/usr/bin/env node
/*
    App script creates the user and tenant management service for Nelson. This includes the different stacks required to create
    - Cognito user pool
    - User management service functions and api gateway
    - Dynamo DB user tables
    - Cloudfront distribution
    - Route53 Hosted Zone and record
    - Dynamo DB tenant tables
    - Tenant management service functions and api gateway

    Dependencies:
    Script needs to be run for a common AWS account.
    Remember to bootstrap execution region + N. Virginia (us-east-1)
*/
import * as cdk from 'aws-cdk-lib';
import { NelsonLoginProviderStack } from '../lib/nelson-login-provider-stack';
import { NelsonUserManagementServiceStack } from '../lib/nelson-user-management-service-stack';
import * as config from 'config';
import { NelsonManagementHostedZoneStack } from '../lib/nelson-management-hosted-zone-stack';
import { NelsonManagementCloudFrontStack } from '../lib/nelson-management-cloudfront-stack';
import { MuiInfrastructureStack } from '../lib/mui-infrastructure-stack';
import { NelsonTenantManagementServiceStack } from '../lib/nelson-tenant-management-stack';
import { NelsonShortLinksStack } from '../lib/short-links/short-links-stack';
import { ShortLinksHostedZoneStack } from '../lib/short-links/short-links-hosted-zone-stack';
import { NelsonShortLinksCloudFrontStack } from '../lib/short-links/short-links-cloudfront-distributions';

const app = new cdk.App();
const hostedZoneStack = new NelsonManagementHostedZoneStack(app, `${config.get('environmentname')}HostedZoneStack`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1' //Certificate of the hosted zone needs to be in N. Virginia. Hosted zones are global anyway
    }
});
const loginProviderStack = new NelsonLoginProviderStack(app, `${config.get('environmentname')}LoginProvider`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    }
});
const userManagementServiceStack = new NelsonUserManagementServiceStack(app, `${config.get('environmentname')}UserManagementService`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    userPoolName: config.get('nelsonloginproviderstack.nelsonuserpool'),
    userPoolId: config.get('nelsonloginproviderstack.nelsonuserpoolid') != '' ? config.get('nelsonloginproviderstack.nelsonuserpoolid') : loginProviderStack.nelsonUserPool.userPoolId,
    loginUrl: config.get('nelsonloginproviderstack.loginurl') != '' ? config.get('nelsonloginproviderstack.loginurl') : loginProviderStack.userPoolDomain.baseUrl(),
    clientId: loginProviderStack.userPoolClient.userPoolClientId,
    clientSecret: loginProviderStack.userPoolClientSecret,
    userPool: loginProviderStack.nelsonUserPool
});
const muiInfrastructureStack = new MuiInfrastructureStack(app, `${config.get('environmentname')}MuiInfrastructure`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    }
});
const tenantManagementServiceStack = new NelsonTenantManagementServiceStack(app, `${config.get('environmentname')}TenantManagementService`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    userPool: loginProviderStack.nelsonUserPool,
    userPoolName: config.get('nelsonloginproviderstack.nelsonuserpool')
});
const shortLinksHostedZoneStack = new ShortLinksHostedZoneStack(app, `${config.get('environmentname')}ShortLinksHostedZone`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1' //Certificate of the hosted zone needs to be in N. Virginia. Hosted zones are global anyway
    }
});
const shortLinksServiceStack = new NelsonShortLinksStack(app, `${config.get('environmentname')}ShortLinksService`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    }
});
const shortlinksCFDistribution = new NelsonShortLinksCloudFrontStack(app, `${config.get('environmentname')}ShortLinksCloudFrontDistributions`, {
    hostedZone: shortLinksHostedZoneStack.hostedZone,
    domainCertificate: shortLinksHostedZoneStack.domainCertificate,
    redirectSvcFunction: shortLinksServiceStack.redirectSvcFunction,
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    crossRegionReferences: true
});
new NelsonManagementCloudFrontStack(app, `${config.get('environmentname')}NelsonManagementCloudFrontDistribution`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    hostedZone: hostedZoneStack.hostedZone,
    viewerAcmCertificateArn: hostedZoneStack.domainCertificate.certificateArn,
    userManagementApiGatewayRestApiId: userManagementServiceStack.userManagementServiceApiGw.restApiId.toString(),
    tenantManagementApiGatewayRestApiId: tenantManagementServiceStack.tenantManagementServiceApiGw.restApiId.toString(),
    apiGatewayRegion: userManagementServiceStack.region.toString(),
    crossRegionReferences: true,
    muiBucket: muiInfrastructureStack.muiBucket
});