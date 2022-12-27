#!/usr/bin/env node
import * as config from 'config';
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SaasInfrastructureStack, VpcStackProps } from '../lib/saas-infrastructure-stack';
import { VpcInfrastructureStack } from '../lib/vpc-infrastructure-stack';
import { NelsonLoginProviderStack } from '../lib/nelson-login-provider-stack';

const app = new cdk.App();

var vpcprops: VpcStackProps = {};
if (config.get('useexistingvpc') == true && config.has('existingvpcid')) {
    vpcprops.vpcid = config.get('existingvpcid') as String;
}
else {
    const vpcStack = new VpcInfrastructureStack(app, `${config.get('environmentname')}VPC`, {
        env: {
            region: config.get('awsregion')
        }
    });
    // vpcprops.cfnvpc = vpcStack.getCfnVpc();
}
new SaasInfrastructureStack(app, `${config.get('environmentname')}SaasInfrastructure`, vpcprops);
//TODO: Continue to implement the remainder of the infrastructure including BUI, MUI, etc...

new NelsonLoginProviderStack(app, `${config.get('environmentname')}LoginProvider`, {
    env: {
        region: config.get('awsregion')
    }
});
