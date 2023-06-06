#!/usr/bin/env node
import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { MuiInfrastructureStack } from '../lib/mui-infrastructure-stack';
import { VpcInfrastructureStack } from '../lib/vpc-infrastructure-stack';
import { SaasInfrastructureStack, VpcStackProps } from '../lib/saas-infrastructure-stack';
import { BuiInfrastructureStack } from '../lib/bui-infrastructure-stack';
import { NelsonManagementHostedZoneStack } from '../lib/nelson-management-hosted-zone-stack';
import { MuiCloudFrontStack } from '../lib/mui-cloudfront-stack';
import { BuiCloudFrontStack } from '../lib/bui-cloudfront-stack';
import { BuiHostedZoneStack } from '../lib/bui-hosted-zone-stack';
import { MuiHostedZoneStack } from '../lib/mui-hosted-zone-stack';

const app = new cdk.App();

var vpcprops: VpcStackProps = {};
var nelsonVpc;
if (config.get('useexistingvpc') == true && config.has('existingvpcname')) {
  vpcprops.vpcname = config.get('existingvpcname') as string;
} else {
  const vpcStack = new VpcInfrastructureStack(app, `${config.get('environmentname')}-vpc`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    }
  });
  vpcprops.vpc = vpcStack.nelsonVpc;
  nelsonVpc = vpcStack.nelsonVpc;
};

const saasInfrastructureStack = new SaasInfrastructureStack(app, `${config.get('environmentname')}SaasInfrastructure`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    vpc: nelsonVpc
});

const buiInfrastructureStack = new BuiInfrastructureStack(app, `${config.get('environmentname')}BuiInfrastructure`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    vpc: saasInfrastructureStack.nelsonVpc,
    privateSG: saasInfrastructureStack.fargateClusterSG,
    
});

const muiInfrastructureStack = new MuiInfrastructureStack(app, `${config.get('environmentname')}MuiInfrastructure`, {
  env: {
    account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
  },
  vpc: saasInfrastructureStack.nelsonVpc,
  privateSG: saasInfrastructureStack.fargateClusterSG
});

const buiHostedZoneStack = new BuiHostedZoneStack(app, `${config.get('environmentname')}BuiHostedZoneStack`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1' //Certificate of the hosted zone needs to be in N. Virginia. Hosted zones are global anyway
    }
});

const buiCloudFrontStack = new BuiCloudFrontStack(app, `${config.get('environmentname')}BuiCloudFront`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    hostedZone: buiHostedZoneStack.hostedZone,
    viewerAcmCertificateArn: buiHostedZoneStack.domainCertificate.certificateArn,
    buiBucketName: buiInfrastructureStack.buiBucket,
    loadBalancerDnsName: saasInfrastructureStack.loadBalancerDnsName,
    crossRegionReferences: true
});

const muiHostedZoneStack = new MuiHostedZoneStack(app, `${config.get('environmentname')}MuiHostedZoneStack`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1' //Certificate of the hosted zone needs to be in N. Virginia. Hosted zones are global anyway
    }
});

const muiCloudFrontStack = new MuiCloudFrontStack(app, `${config.get('environmentname')}MuiCloudFront`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    hostedZone: muiHostedZoneStack.hostedZone,
    viewerAcmCertificateArn: muiHostedZoneStack.domainCertificate.certificateArn,
    muiBucketName: muiInfrastructureStack.muiBucket,
    loadBalancerDnsName: saasInfrastructureStack.loadBalancerDnsName,
    crossRegionReferences: true
});



