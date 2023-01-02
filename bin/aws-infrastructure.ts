#!/usr/bin/env node
import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { SaasInfrastructureStack, VpcStackProps } from '../lib/saas-infrastructure-stack';
import { VpcInfrastructureStack } from '../lib/vpc-infrastructure-stack';
import { MuiInfrastructureStack } from '../lib/mui-infrastructure-stack';

const app = new cdk.App();

var vpcprops: VpcStackProps = {};
if (config.get('useexistingvpc') == true && config.has('existingvpcname')) {
  vpcprops.vpcname = config.get('existingvpcname') as string;
}
else {
  const vpcStack = new VpcInfrastructureStack(app, `${config.get('environmentname')}VPC`, {
    env: {
      region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    }
  });
  vpcprops.vpc = vpcStack.nelsonVPC;
}
new SaasInfrastructureStack(app, `${config.get('environmentname')}SaasInfrastructure`, vpcprops);

new MuiInfrastructureStack(app, `${config.get('environmentname')}MuiInfrastructure`);
//TODO: Continue to implement the remainder of the infrastructure including BUI, MUI, etc...
