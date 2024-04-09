import * as cdk from 'aws-cdk-lib';
import * as config from 'config';
import { AmazonLinuxImage, ISecurityGroup, IVpc, Instance, InstanceClass, InstanceSize, InstanceType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, IpAddressType, TargetType } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import path = require('path');
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface NpriceStackProps extends cdk.StackProps {
    vpc: IVpc;
}

export class NpriceInfrastructureStack extends cdk.Stack {

    constructor(construct: Construct, id: string, props: NpriceStackProps) {
        super(construct, id, props);
        
        if (config.get('npriceinfrastructurestack.issupportednprice')) {
                // Create bastion
            const bastionSG = new ec2.SecurityGroup(this, `${config.get('environmentname')}BasitionSecurityGroup`, {
                vpc: props.vpc,
                allowAllOutbound: true,
                description: `Security group for bastion`,
                securityGroupName: `${config.get('environmentname')}-bastion`
            });
            bastionSG.addIngressRule(ec2.Peer.ipv4('34.250.229.189/32'), ec2.Port.tcp(80), 'Omena VPN');
            bastionSG.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            cdk.Aspects.of(bastionSG).add(
                new cdk.Tag('Name', `${config.get('environmentname')}-bastion-sg`)
            );
            cdk.Aspects.of(bastionSG).add(
                new cdk.Tag('nelson:client', 'saas')
            );
            cdk.Aspects.of(bastionSG).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(bastionSG).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );

            // Configurations for Nprice API
            const npriceApiElbSG = new ec2.SecurityGroup(this, `${config.get('environmentname')}NpriceAPIElbSecurityGroup`, {
                vpc: props.vpc,
                allowAllOutbound: true,
                description: 'Security group for nprice API ELB',
                securityGroupName: `${config.get('environmentname')}-nprice-api-elb-sg`
            });
            npriceApiElbSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Receive all traffics from internet via port 80');
            npriceApiElbSG.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            cdk.Aspects.of(npriceApiElbSG).add(
                new cdk.Tag('Name', `${config.get('environmentname')}-nprice-api-elb-sg`)
            );
            cdk.Aspects.of(npriceApiElbSG).add(
                new cdk.Tag('nelson:client', 'saas')
            );
            cdk.Aspects.of(npriceApiElbSG).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(npriceApiElbSG).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );

            const npriceApiSG = new ec2.SecurityGroup(this, `${config.get('environmentname')}NpriceAPISecurityGroup`, {
                vpc: props.vpc,
                allowAllOutbound: true,
                description: 'Security group for nprice API',
                securityGroupName: `${config.get('environmentname')}-nprice-api-sg`
            });
            npriceApiSG.connections.allowFrom(npriceApiElbSG, ec2.Port.tcp(80));
            npriceApiSG.connections.allowFromAnyIpv4(ec2.Port.tcp(config.get('npriceinfrastructurestack.integrationapiport')));
            npriceApiSG.applyRemovalPolicy(config.get('defaultremovalpolicy'));

            const npriceApiALB = new ApplicationLoadBalancer(this, 'ALB', {
                vpc: props.vpc,
                internetFacing: true,
                loadBalancerName: `${config.get('environmentname')}NpiceApiALb`,
                securityGroup: npriceApiElbSG,
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PUBLIC
                },
                ipAddressType: IpAddressType.IPV4
            });

            const targetGroup = new ApplicationTargetGroup(this, `${config.get('environmentname')}NpriceApiTG`, {
                port: 80,
                protocol: ApplicationProtocol.HTTP,
                targetType: TargetType.IP,
                vpc: props.vpc,
                targetGroupName: `${config.get('environmentname')}-nprice-api-tg-01`,
                healthCheck: {
                    path: '/status'
                }
            });
            npriceApiALB.applyRemovalPolicy(config.get('defaultremovalpolicy'));

            const npriceRole = new iam.Role(this, 'NpriceEC2Role', {
                roleName: `${config.get('environmentname')}-nprice-ec2-role`,
                assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com")
            });
            npriceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
            npriceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMFullAccess'));
            npriceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'));

            const setupCommands = ec2.UserData.forLinux();
            setupCommands.addCommands(
                'sudo yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm',
                'sudo systemctl enable amazon-ssm-agent',
                'sudo systemctl start amazon-ssm-agent'
            );

            const multipartUserData = new ec2.MultipartUserData();
            multipartUserData.addPart(ec2.MultipartBody.fromUserData(setupCommands));

            const npriceApiInstance = new Instance(this, `${config.get('environmentname')}NpriceApiInstance`, {
                instanceType: InstanceType.of(
                    InstanceClass.T2,
                    InstanceSize.MICRO,
                ),
                machineImage: ec2.MachineImage.latestAmazonLinux({
                    generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
                }),
                vpc: props.vpc as Vpc,
                securityGroup: npriceApiSG,
                instanceName: `${config.get('environmentname')}-nprice-api`,
                role: npriceRole,
                userData: multipartUserData
            });
            npriceApiInstance.applyRemovalPolicy(config.get('defaultremovalpolicy'));

            if (config.get('npriceinfrastructurestack.isactivatednpricecore')) {
    
                // Configurations for nprice core
                const npriceCoreSG = new ec2.SecurityGroup(this, `${config.get('environmentname')}NpriceCoreSecurityGroup`, {
                    vpc: props.vpc,
                    allowAllOutbound: true,
                    description: 'Security group for nprice core',
                    securityGroupName: `${config.get('environmentname')}-nprice-core-sg`
                });
                npriceCoreSG.connections.allowFrom(bastionSG, ec2.Port.tcp(22));
                npriceCoreSG.applyRemovalPolicy(config.get('defaultremovalpolicy'));
                cdk.Aspects.of(npriceCoreSG).add(
                    new cdk.Tag('Name', `${config.get('environmentname')}-nprice-core-sg`)
                );
                cdk.Aspects.of(npriceCoreSG).add(
                    new cdk.Tag('nelson:client', 'saas')
                );
                cdk.Aspects.of(npriceCoreSG).add(
                    new cdk.Tag('nelson:role', 'service')
                );
                cdk.Aspects.of(npriceCoreSG).add(
                    new cdk.Tag('nelson:environment', config.get('environmentname'))
                );
    
                const npriceCoreInstance = new Instance(this, `${config.get('environmentname')}NpriceCoreInstance`, {
                    instanceType: InstanceType.of(
                        InstanceClass.M4,
                        InstanceSize.XLARGE
                    ),
                    machineImage: ec2.MachineImage.latestAmazonLinux({
                        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
                    }),
                    vpc: props.vpc as Vpc,
                    securityGroup: npriceCoreSG,
                    instanceName: `${config.get('environmentname')}-nprice-core`,
                    role: npriceRole,
                    userData: multipartUserData
                });
                npriceCoreInstance.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        
                const npriceCoreStarerScript = new lambda.Function(this, 'NpriceCoreStarerScript', {
                    runtime: lambda.Runtime.PYTHON_3_7,
                    functionName: `${config.get('environmentname')}-nprice_core_starter_script`,
                    architecture: lambda.Architecture.X86_64,
                    handler: 'lambda_function.lambda_handler',
                    code: lambda.Code.fromAsset(path.join(__dirname, '/../assets/nprice-core')),
                    timeout: cdk.Duration.seconds(15),
                    description: 'This fucntion checks that the nPrice core is stopped and starts it, otherwise it will sen a notification.',
                    environment: {
                        NPRICE_CORE_INSTANCE_ID: npriceCoreInstance.instanceId,
                        NPRICE_CORE_INSTANCE_NAME: config.get('environmentname'),
                        SNS_ARN: config.get('npriceinfrastructurestack.snsarn'),
                        REGION: config.get('npriceinfrastructurestack.region')
                    },
                });
                npriceCoreStarerScript.applyRemovalPolicy(config.get('defaultremovalpolicy'));
                cdk.Aspects.of(npriceCoreStarerScript).add(
                    new cdk.Tag('Name', `${config.get('environmentname')}-nprice-starter-script`)
                );
                cdk.Aspects.of(npriceCoreStarerScript).add(
                    new cdk.Tag('nelson:client', 'saas')
                );
                cdk.Aspects.of(npriceCoreStarerScript).add(
                    new cdk.Tag('nelson:role', 'service')
                );
                cdk.Aspects.of(npriceCoreStarerScript).add(
                    new cdk.Tag('nelson:environment', config.get('environmentname'))
                );
        
                npriceCoreStarerScript.addToRolePolicy(PolicyStatement.fromJson(
                    {
                        'Sid': 'EC2StartDescribe',
                        'Effect': 'Allow',
                        'Action': 'ec2:DescribeInstances',
                        'Resource': '*'
                    },
                ));
                npriceCoreStarerScript.addToRolePolicy(PolicyStatement.fromJson(
                    {
                        'Sid': 'SNSPublish',
                        'Effect': 'Allow',
                        'Action': [
                            'sns:Publish',
                            'ec2:StartInstances'
                        ],
                        'Resource': [
                            config.get('npriceinfrastructurestack.snsarn'),
                            `arn:aws:ec2:${this.region}:${this.account}:instance/${npriceCoreInstance.instanceId}`
                        ]
                    },
                ));
        
                const nPriceCoreStartEventTrigger = new Rule(this, 'NpriceCoreStarterRule', {
                    ruleName: `${config.get('environmentname')}-nPriceCoreStarter`,
                    description: `Event to trigger the nprice starter lambda function for ${config.get('environmentname')} environment`,
                    enabled: true,
                    schedule: Schedule.cron(config.get('npriceinfrastructurestack.corebootcron')),
                    targets: [
                        new cdk.aws_events_targets.LambdaFunction(npriceCoreStarerScript)
                    ]
                });
                nPriceCoreStartEventTrigger.applyRemovalPolicy(config.get('defaultremovalpolicy'));
                cdk.Aspects.of(nPriceCoreStartEventTrigger).add(
                    new cdk.Tag('Name', `${config.get('environmentname')}-nprice-starter-script`)
                );
                cdk.Aspects.of(nPriceCoreStartEventTrigger).add(
                    new cdk.Tag('nelson:client', 'saas')
                );
                cdk.Aspects.of(nPriceCoreStartEventTrigger).add(
                    new cdk.Tag('nelson:role', 'service')
                );
                cdk.Aspects.of(nPriceCoreStartEventTrigger).add(
                    new cdk.Tag('nelson:environment', config.get('environmentname'))
                );
            }
        }
    }
}
