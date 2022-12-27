/*
    Stack creates the a new VPC
*/

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as config from 'config';
import { IpAddresses } from 'aws-cdk-lib/aws-ec2';

export class VpcInfrastructureStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Step1: Create a VPC and things related to VPC
        const nelsonVPC = new ec2.Vpc(this, `${config.get('environmentname')}VPC`, {
            ipAddresses: IpAddresses.cidr(config.get('vpcservice.cidr')),
            maxAzs: Number(config.get('vpcservice.maxazs')),
            natGateways: Number(config.get('vpcservice.maxnatgateways')),
            subnetConfiguration: [
                {
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: config.get('vpcservice.cidrMask')
                },
                {
                    name: 'private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: config.get('vpcservice.cidrMask')
                }
            ]
        });

        // Step2: Re-tagging for publicSubnets
        for (const publicSubnet of nelsonVPC.publicSubnets) {
            cdk.Aspects.of(publicSubnet).add(
                new cdk.Tag('Name', `${nelsonVPC.node.id}-${publicSubnet.node.id.replace(/Subnet[0-9]$/, '')}-${publicSubnet.availabilityZone}`)
            ); 
        }

        // Step3: Re-tagging for privateSubnets
        for (const privateSubnet of nelsonVPC.privateSubnets) {
            cdk.Aspects.of(privateSubnet).add(
                new cdk.Tag('Name', `${nelsonVPC.node.id}-${privateSubnet.node.id.replace(/Subnet[0-9]$/, '')}-${privateSubnet.availabilityZone}`)
            ); 
        }
        
    }
}
