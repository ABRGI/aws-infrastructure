/*
    Stack creates the a new VPC
*/

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as config from 'config';
import { IpAddresses } from 'aws-cdk-lib/aws-ec2';

export class VpcInfrastructureStack extends cdk.Stack {
    nelsonVPC: ec2.Vpc;
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const nelsonEnv: string = config.get('environmentname');
        const nelsonClient = 'saas';
        const nelsonRole = 'service';

        // Step1: Create a VPC and things related to VPC
        this.nelsonVPC = new ec2.Vpc(this, `VPC`, {
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
            ],
            vpcName: `${nelsonEnv}-vpc`,
        });

        // Step2: Re-tagging for publicSubnets
        for (const publicSubnet of this.nelsonVPC.publicSubnets) {
            cdk.Aspects.of(publicSubnet).add(
                new cdk.Tag('Name', `${nelsonEnv}-${publicSubnet.node.id.replace(/Subnet[0-9]$/, '')}-${publicSubnet.availabilityZone}`)
            );
            cdk.Aspects.of(publicSubnet).add(
                new cdk.Tag('nelson:client', nelsonClient)
            );
            cdk.Aspects.of(publicSubnet).add(
                new cdk.Tag('nelson:role', nelsonRole)
            );
            cdk.Aspects.of(publicSubnet).add(
                new cdk.Tag('nelson:env', nelsonEnv)
            );
        }

        // Step3: Re-tagging for privateSubnets
        for (const privateSubnet of this.nelsonVPC.privateSubnets) {
            cdk.Aspects.of(privateSubnet).add(
                new cdk.Tag('Name', `${nelsonEnv}-${privateSubnet.node.id.replace(/Subnet[0-9]$/, '')}-${privateSubnet.availabilityZone}`)
            );
            cdk.Aspects.of(privateSubnet).add(
                new cdk.Tag('nelson:client', nelsonClient)
            );
            cdk.Aspects.of(privateSubnet).add(
                new cdk.Tag('nelson:role', nelsonRole)
            );
            cdk.Aspects.of(privateSubnet).add(
                new cdk.Tag('nelson:env', nelsonEnv)
            );
        }

        cdk.Aspects.of(this.nelsonVPC).add(
            new cdk.Tag('nelson:client', nelsonClient)
        );
        cdk.Aspects.of(this.nelsonVPC).add(
            new cdk.Tag('nelson:role', nelsonRole)
        );
        cdk.Aspects.of(this.nelsonVPC).add(
            new cdk.Tag('nelson:env', nelsonEnv)
        );
    }
}
