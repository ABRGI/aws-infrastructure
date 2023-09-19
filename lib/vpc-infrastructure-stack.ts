/*
    Stack creates the a new VPC
*/

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as config from 'config';
import { IpAddresses } from 'aws-cdk-lib/aws-ec2';
import { Environment } from 'aws-cdk-lib';

export class VpcInfrastructureStack extends cdk.Stack {
    nelsonVpc: ec2.IVpc;
    albSGId: String;
    privateSGId: String;
    env: Environment;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        // Create a VPC and things related to VPC
        this.nelsonVpc = new ec2.Vpc(this, `VPC`, {
            ipAddresses: IpAddresses.cidr(config.get('vpcservice.cidr')),
            maxAzs: Number(config.get('vpcservice.maxazs')),
            natGateways: Number(config.get('vpcservice.maxnatgateways')),
            subnetConfiguration: [
                {
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: config.get('vpcservice.cidrMask'),
                },
                {
                    name: 'private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: config.get('vpcservice.cidrMask')
                }
            ],
            vpcName: `${config.get('environmentname')}-vpc`
        });
        this.nelsonVpc.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        // Re-tagging for publicSubnets
        for (const publicSubnet of this.nelsonVpc.publicSubnets) {
            cdk.Aspects.of(publicSubnet).add(
                new cdk.Tag('Name', `${config.get('environmentname')}-${publicSubnet.node.id.replace(/Subnet[0-9]$/, '')}-${publicSubnet.availabilityZone}`)
            );
            cdk.Aspects.of(publicSubnet).add(
                new cdk.Tag('nelson:client', 'saas')
            );
            cdk.Aspects.of(publicSubnet).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(publicSubnet).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
        }

        // Re-tagging for privateSubnets
        for (const privateSubnet of this.nelsonVpc.privateSubnets) {
            cdk.Aspects.of(privateSubnet).add(
                new cdk.Tag('Name', `${config.get('environmentname')}-${privateSubnet.node.id.replace(/Subnet[0-9]$/, '')}-${privateSubnet.availabilityZone}`)
            );
            cdk.Aspects.of(privateSubnet).add(
                new cdk.Tag('nelson:client', 'saas')
            );
            cdk.Aspects.of(privateSubnet).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(privateSubnet).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
        }

        // Re-tagging for VPC
        cdk.Aspects.of(this.nelsonVpc).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(this.nelsonVpc).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(this.nelsonVpc).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(this.nelsonVpc).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-vpc`)
        );

    }
}
