/*
    Code contains the infrastructure stack for the Nelson Saas platform.
    This will include ECS deployments, ALB, cloud front configurations, route 53 configs, RDS deployments, etc.
    VPC will be created in another stack and referred here using Cfn outputs.

    Dependency:
    - Requires VPC to be passed in the props. VPC can either be existing VPC data or a new VPC.
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { CfnVPC } from 'aws-cdk-lib/aws-ec2';

export interface VpcStackProps extends cdk.StackProps {
    vpcid?: String
    cfnvpc?: CfnVPC
}

export class SaasInfrastructureStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: VpcStackProps) {
        super(scope, id, props);

        //TODO: Validate VPC. Update the vpc stack props interface if required to get the correct data.
    }
}
