#!/usr/bin/env node
import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { MuiInfrastructureStack } from '../lib/mui-infrastructure-stack';
import { VpcInfrastructureStack } from '../lib/vpc-infrastructure-stack';
import { SaasInfrastructureStack, VpcStackProps } from '../lib/saas-infrastructure-stack';
import { BuiInfrastructureStack } from '../lib/bui-infrastructure-stack';

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

// new BuiInfrastructureStack(app, `${config.get('environmentname')}BuiInfrastructure`, {
//     env: {
//         account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
//         region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
//     },
//     vpc: saasInfrastructureStack.nelsonVpc,
//     privateSG: saasInfrastructureStack.fargateClusterSG
// });

// new MuiInfrastructureStack(app, `${config.get('environmentname')}MuiInfrastructure`, {
//   env: {
//     account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
//     region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
//   }
// });
//TODO: Continue to implement the remainder of the infrastructure including BUI, MUI, etc...
