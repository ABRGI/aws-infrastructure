/*
    Stack creates the a new VPC
*/

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';

export class VpcInfrastructureStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        //TODO: Create a VPC here
    }
}
