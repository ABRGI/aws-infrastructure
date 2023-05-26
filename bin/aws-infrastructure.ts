#!/usr/bin/env node
import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { MuiInfrastructureStack } from '../lib/mui-infrastructure-stack';
import { VpcInfrastructureStack } from '../lib/vpc-infrastructure-stack';
import { SaasInfrastructureStack, VpcStackProps } from '../lib/saas-infrastructure-stack';
import { BuiInfrastructureStack } from '../lib/bui-infrastructure-stack';
import { NelsonManagementHostedZoneStack } from '../lib/nelson-management-hosted-zone-stack';
import { BuiCloudFrontStack } from '../lib/bui-cloudfront-stack';
import { ListenerCertificate } from 'aws-cdk-lib/aws-elasticloadbalancingv2';

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

const hostedZoneStack = new NelsonManagementHostedZoneStack(app, `${config.get('environmentname')}HostedZoneStack`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1' //Certificate of the hosted zone needs to be in N. Virginia. Hosted zones are global anyway
    }
});

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

new BuiCloudFrontStack(app, `${config.get('environmentname')}BuiCloudFront`, {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    },
    hostedZone: hostedZoneStack.hostedZone,
    viewerAcmCertificateArn: ListenerCertificate.fromArn('arn:aws:acm:eu-central-1:459045743560:certificate/23fb79fa-0ab6-4c82-baa8-697d963ba824').certificateArn,
    buiBucket: buiInfrastructureStack.buiBucket,
    loadBalancerDnsName: saasInfrastructureStack.loadBalancerDnsName
});



