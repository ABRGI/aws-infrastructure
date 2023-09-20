/*
    Code contains the infrastructure stack for the Nelson Saas platform.
    This will include ECS deployments, ALB, cloud front configurations, route 53 configs, RDS deployments, etc.
    VPC will be created in another stack and referred here using Cfn outputs.

    Dependency:
    - Requires VPC to be passed in the props. VPC can either be existing VPC data or a new VPC.
*/
import * as cdk from 'aws-cdk-lib';
import * as config from 'config';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { BuildEnvironmentVariableType, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { CodeBuildAction, CodeBuildActionType, CodeDeployEcsDeployAction, CodeStarConnectionsSourceAction, S3SourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Artifact, ArtifactPath, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, IpAddressType, ListenerCertificate, TargetType } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Cluster } from 'aws-cdk-lib/aws-ecs';
import { DummyTaskDefinition } from '@cloudcomponents/cdk-blue-green-container-deployment/lib/dummy-task-definition';
import { EcsService, EcsDeploymentGroup } from '@cloudcomponents/cdk-blue-green-container-deployment';
import { Duration } from 'aws-cdk-lib';
import { LogGroup } from 'aws-cdk-lib/aws-logs';

export interface VpcStackProps extends cdk.StackProps {
    vpcname?: string
    vpc?: ec2.IVpc
}
export class SaasInfrastructureStack extends cdk.Stack {
    nelsonVpc: ec2.IVpc;
    albSG: ec2.ISecurityGroup; // public security group
    fargateClusterSG: ec2.ISecurityGroup; // private security group
    applicationLoadBalancer: ApplicationLoadBalancer;

    constructor(scope: Construct, id: string, props?: VpcStackProps) {
        super(scope, id, props);
        if (props?.vpcname != null) {
            this.nelsonVpc = ec2.Vpc.fromLookup(this, 'VPC', {
                vpcName: props.vpcname,
            });
        } else {
            this.nelsonVpc = props?.vpc as ec2.IVpc;
        }

        if (config.get('useexistingalbsg') == true && config.has('albsgId')) {
            this.albSG = ec2.SecurityGroup.fromLookupById(this, 'SG', config.get('albsgId'));
        } else {
            // Create security group for alb
            const albSG = new ec2.SecurityGroup(this, 'ALBSG', {
                vpc: this.nelsonVpc,
                securityGroupName: `${config.get('environmentname')}-alb-sg`,
                allowAllOutbound: true
            });
            // Add inbound rules for albSG
            albSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Receive all traffics from internet via port 443');
            albSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8443), 'Receive all traffics from internet via port 8443 - testing port');
            albSG.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            cdk.Aspects.of(albSG).add(
                new cdk.Tag('Name', `${config.get('environmentname')}-alb-sg`)
            );
            cdk.Aspects.of(albSG).add(
                new cdk.Tag('nelson:client', 'saas')
            );
            cdk.Aspects.of(albSG).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(albSG).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
            this.albSG = albSG;
        }

        if (config.get('useexistingfargateclustersg') == true && config.has('fargateclustersgid')) {
            this.fargateClusterSG = ec2.SecurityGroup.fromLookupById(this, 'SG', config.get('fargateclustersgid'));
        } else {
            // Create security group for Fargate cluster
            const fargateClusterSG = new ec2.SecurityGroup(this, 'FargateSG', {
                vpc: this.nelsonVpc,
                securityGroupName: `${config.get('environmentname')}-fargate-cluster-sg`,
                allowAllOutbound: true
            });

            const portProps: ec2.PortProps = {
                protocol: ec2.Protocol.TCP,
                stringRepresentation: '',
                fromPort: 0,
                toPort: 65535
            };
            fargateClusterSG.connections.allowFrom(this.albSG, new ec2.Port(portProps));
            fargateClusterSG.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            cdk.Aspects.of(fargateClusterSG).add(
                new cdk.Tag('Name', `${config.get('environmentname')}-fargate-cluster-sg`)
            );
            cdk.Aspects.of(fargateClusterSG).add(
                new cdk.Tag('nelson:client', 'saas')
            );
            cdk.Aspects.of(fargateClusterSG).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(fargateClusterSG).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
            this.fargateClusterSG = fargateClusterSG;
        }

        if (!config.get('saasinfrastructurestack.useexistingdb')) {
            const dbSecurityGroup = new ec2.SecurityGroup(this, "dbSecurityGroup", {
                vpc: this.nelsonVpc,
                allowAllOutbound: true,
                description: "Security group for RDS",
                securityGroupName: `${config.get('environmentname')}-db-sg`
            });
            for (const privateSubnet of this.nelsonVpc.privateSubnets) {
                dbSecurityGroup.addIngressRule(ec2.Peer.ipv4(privateSubnet.ipv4CidrBlock), ec2.Port.tcp(5432), 'Receive all traffics from internet via port 443');
            }
            dbSecurityGroup.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            cdk.Aspects.of(dbSecurityGroup).add(
                new cdk.Tag('nelson:client', 'saas')
            );
            cdk.Aspects.of(dbSecurityGroup).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(dbSecurityGroup).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
            cdk.Aspects.of(dbSecurityGroup).add(
                new cdk.Tag('Name', `${config.get('environmentname')}-db-sg`)
            );

            // Create nelson DB
            const nelsonDB = new rds.DatabaseCluster(this, 'Database', {
                engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_13_7 }),
                instanceProps: {
                    vpc: this.nelsonVpc,
                    vpcSubnets: {
                        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
                    },
                    securityGroups: [dbSecurityGroup],
                    publiclyAccessible: false
                },
                defaultDatabaseName: 'nelson',
                instances: 1,
                instanceIdentifierBase: `${config.get('environmentname')}-saas-nelson-services-db-instance-`,
                credentials: rds.Credentials.fromSecret(Secret.fromSecretNameV2(this, 'DBCredential', 'cdkRDSCredential')),
                removalPolicy: config.get('defaultremovalpolicy'),
                clusterIdentifier: `${config.get('environmentname')}-saas-nelson-services-db-cluster`
            });
            cdk.Aspects.of(nelsonDB).add(
                new cdk.Tag('nelson:client', 'saas')
            );
            cdk.Aspects.of(nelsonDB).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(nelsonDB).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
            cdk.Aspects.of(nelsonDB).add(
                new cdk.Tag('Name', `${config.get('environmentname')}-rds`)
            );

        }

        const cfnVPCPeeringConn = new ec2.CfnVPCPeeringConnection(this, 'PeeringConnection', {
            vpcId: this.nelsonVpc.vpcId,
            peerVpcId: config.get('saasinfrastructurestack.existingdbvpcid')
        });
        cfnVPCPeeringConn.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(cfnVPCPeeringConn).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(cfnVPCPeeringConn).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(cfnVPCPeeringConn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(cfnVPCPeeringConn).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-vpc-to-db`)
        );

        // Create ALB
        this.applicationLoadBalancer = new ApplicationLoadBalancer(this, 'ALB', {
            vpc: this.nelsonVpc,
            internetFacing: true,
            loadBalancerName: `${config.get('environmentname')}`,
            securityGroup: this.albSG,
            vpcSubnets: {
                subnetType: SubnetType.PUBLIC
            },
            ipAddressType: IpAddressType.IPV4
        });
        
        cdk.Aspects.of(this.applicationLoadBalancer).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(this.applicationLoadBalancer).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(this.applicationLoadBalancer).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(this.applicationLoadBalancer).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-alb`)
        );

        const targetGroup1 = new ApplicationTargetGroup(this, 'TG1', {
            port: 80,
            protocol: ApplicationProtocol.HTTP,
            targetType: TargetType.IP,
            vpc: this.nelsonVpc,
            targetGroupName: `${config.get('environmentname')}-tg-01`,
            healthCheck: {
                path: '/status',
                timeout: Duration.seconds(60),
                interval: Duration.seconds(120)

            }
        });
        cdk.Aspects.of(targetGroup1).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(targetGroup1).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(targetGroup1).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(targetGroup1).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-target-group-01`)
        );

        const prodLisener = this.applicationLoadBalancer.addListener('ProdListener', {
            port: 443,
            protocol: ApplicationProtocol.HTTPS,
            defaultTargetGroups: [targetGroup1]

        });
        if (config.get('saasinfrastructurestack.buidomaincertificatearn')) {
            prodLisener.addCertificates('BuiDomainCertificate', [ListenerCertificate.fromArn(config.get('saasinfrastructurestack.buidomaincertificatearn'))]);
        }
        if (config.get('saasinfrastructurestack.muidomaincertificatearn')) {
            prodLisener.addCertificates('MuiDomainCertificate', [ListenerCertificate.fromArn(config.get('saasinfrastructurestack.muidomaincertificatearn'))]);
        }
        cdk.Aspects.of(prodLisener).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(prodLisener).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(prodLisener).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(prodLisener).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-prod-listener`)
        );
        prodLisener.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        const targetGroup2 = new ApplicationTargetGroup(this, 'TG2', {
            port: 80,
            protocol: ApplicationProtocol.HTTP,
            targetType: TargetType.IP,
            vpc: this.nelsonVpc,
            targetGroupName: `${config.get('environmentname')}-tg-02`,
            healthCheck: {
                path: '/status',
                timeout: Duration.seconds(60),
                interval: Duration.seconds(120)
            }
        });
        cdk.Aspects.of(targetGroup2).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(targetGroup2).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(targetGroup2).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(targetGroup2).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-target-group-02`)
        );

        const testListener = this.applicationLoadBalancer.addListener('TestListener', {
            port: 8443,
            protocol: ApplicationProtocol.HTTPS,
            defaultTargetGroups: [targetGroup2]
        });
        if (config.get('saasinfrastructurestack.buidomaincertificatearn')) {
            testListener.addCertificates('BuiDomainCertificate', [ListenerCertificate.fromArn(config.get('saasinfrastructurestack.buidomaincertificatearn'))]);
        }
        if (config.get('saasinfrastructurestack.muidomaincertificatearn')) {
            testListener.addCertificates('MuiDomainCertificate', [ListenerCertificate.fromArn(config.get('saasinfrastructurestack.muidomaincertificatearn'))]);
        }
        testListener.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        this.applicationLoadBalancer.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(testListener).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(testListener).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(testListener).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(testListener).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-test-listener`)
        );

        // Create log group for ECS
        const ecsLogs = new LogGroup(this, 'ECSLogGroup', {
            logGroupName: `/ecs/${config.get('environmentname')}-${config.get('saasinfrastructurestack.codebuildenvvariables.appname')}`
        });
        ecsLogs.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(ecsLogs).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(ecsLogs).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(ecsLogs).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(ecsLogs).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-ecs-log-group`)
        );

        // Create ECSCluster
        const cluster = new Cluster(this, 'FargateCluster', {
            clusterName: config.get('environmentname'),
            vpc: this.nelsonVpc
        });
        cdk.Aspects.of(cluster).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(cluster).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(cluster).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(cluster).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-ecs-cluster`)
        );

        // Dummy task definition first
        const taskDefinition = new DummyTaskDefinition(this, 'DummyTaskDefinition', {
            image: 'nginx',
            family: 'blue-green'
        });
        cdk.Aspects.of(taskDefinition).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(taskDefinition).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(taskDefinition).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(taskDefinition).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-task-definition`)
        );
        
        console.log('shortlinklambdaarn: ' + config.get('saasinfrastructurestack.shortlinklambdaarn'));
        const ecsTaskRolePolicy = new iam.PolicyStatement({
            actions: [
                'lambda:InvokeFunction'
            ],
            resources: [config.get('saasinfrastructurestack.shortlinklambdaarn')]
        });

        const taskRole = new iam.Role(this, 'ECSTaskRole', {
            roleName: `${config.get('environmentname')}-task-role`,
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
        });
        taskRole.addToPolicy(ecsTaskRolePolicy);
        taskRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        

        const ecsService = new EcsService(this, 'EcsService', {
            cluster: cluster,
            serviceName: 'nelson',
            desiredCount: 2,
            taskDefinition: taskDefinition,
            prodTargetGroup: targetGroup1,
            testTargetGroup: targetGroup2

        });
        cdk.Aspects.of(ecsService).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(ecsService).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(ecsService).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(ecsService).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-ecs-service`)
        );

        const portProps: ec2.PortProps = {
            protocol: ec2.Protocol.TCP,
            stringRepresentation: '',
            fromPort: 0,
            toPort: 65535
        };
        ecsService.connections.allowFrom(this.albSG, new ec2.Port(portProps));
        cluster.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        // Create code build
        const nelsonCodeBuildRole = new iam.Role(this, 'NelsonCBRole', {
            roleName: `codebuild-${config.get('environmentname')}-nelson-service-role`,
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryFullAccess')
            ]
        });
        nelsonCodeBuildRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(nelsonCodeBuildRole).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(nelsonCodeBuildRole).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(nelsonCodeBuildRole).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(nelsonCodeBuildRole).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-nelson-codebuild-role`)
        );

        const nelsonCodeBuildSource = codebuild.Source.gitHub({
            owner: 'ABRGI',
            repo: config.get('saasinfrastructurestack.nelsonrepo'),
            branchOrRef: '',
            webhook: true,
            webhookTriggersBatchBuild: false,
            webhookFilters: [
                codebuild.FilterGroup
                    .inEventOf(codebuild.EventAction.PUSH)
                    .andBranchIs(config.get('saasinfrastructurestack.nelsonbranch')),
                codebuild.FilterGroup
                    .inEventOf(codebuild.EventAction.PULL_REQUEST_MERGED)
                    .andHeadRefIs('^refs/heads/*$')
                    .andBaseRefIs(`^refs/heads/${config.get('saasinfrastructurestack.nelsonbranch')}$`)
            ],
        });

        //Use existing bucket ARN
        const artifactBucket = Bucket.fromBucketArn(this, 'S3ArtifactsBucket', 'arn:aws:s3:::developer-tool-artifacts');
        const nelsonCodeBuildArtifacts = codebuild.Artifacts.s3({
            bucket: artifactBucket,
            includeBuildId: false,
            packageZip: true,
            path: config.get('environmentname'),
            encryption: true
        });

        const nelsonCodeBuildProject = new codebuild.Project(this, 'NelsonCodeBuildProject', {
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            artifacts: nelsonCodeBuildArtifacts,
            source: nelsonCodeBuildSource,
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
                computeType: codebuild.ComputeType.MEDIUM,
                privileged: true,
            },
            vpc: this.nelsonVpc,
            subnetSelection: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            },
            role: nelsonCodeBuildRole,
            securityGroups: [this.fargateClusterSG],
            projectName: `${config.get('environmentname')}-nelson`,
            encryptionKey: Key.fromKeyArn(this, 'EncryptionKey', 'arn:aws:kms:eu-central-1:459045743560:alias/aws/s3'),
            environmentVariables: {
                ENV: {
                    value: config.get('environmentname'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                APP_NAME: {
                    value: config.get('saasinfrastructurestack.codebuildenvvariables.appname'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                MAJOR_VERSION_NUMBER: {
                    value: config.get('saasinfrastructurestack.codebuildenvvariables.majorversionnumber'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                MINOR_VERSION_NUMBER: {
                    value: config.get('saasinfrastructurestack.codebuildenvvariables.minorversionnumber'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                REPO: {
                    value: config.get('saasinfrastructurestack.codebuildenvvariables.repo'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                }
            }
        });
        nelsonCodeBuildProject.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(nelsonCodeBuildProject).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(nelsonCodeBuildProject).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(nelsonCodeBuildProject).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(nelsonCodeBuildProject).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-nelson-codebuild`)
        );

        // Create code pipelines
        const nelsonSourceOutput = new Artifact('nelson');
        const nelsonDeplSourceOutput = new Artifact('nelson-deployment');

        // Create nelson code pipelines
        const nelsonSourceAction = new S3SourceAction({
            actionName: 'nelson',
            bucket: artifactBucket,
            bucketKey: `${config.get('environmentname')}/nelson`,
            output: nelsonSourceOutput
        });

        const nelsonDeplSourceAction = new CodeStarConnectionsSourceAction({
            actionName: 'Source',
            owner: config.get('saasinfrastructurestack.owner'),
            repo: config.get('saasinfrastructurestack.nelsondeploymentrepo'),
            branch: config.get('saasinfrastructurestack.nelsondeploymentbranch'),
            output: nelsonDeplSourceOutput,
            connectionArn: config.get('connectionarn')
        });

        const nelsonDeplCodeBuildRole = new iam.Role(this, 'NelsonDeploymentCBRole', {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
            roleName: `codebuild-${config.get('environmentname')}-nelson-deployment-service-role`,
        });
        nelsonDeplCodeBuildRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        nelsonDeplCodeBuildRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryFullAccess'));
        nelsonDeplCodeBuildRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(nelsonDeplCodeBuildRole).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(nelsonDeplCodeBuildRole).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(nelsonDeplCodeBuildRole).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(nelsonDeplCodeBuildRole).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-nelson-deployment-cb-role`)
        );

        const nelsonDeploymentCodeBuild = new PipelineProject(this, 'NelsonDeploymentCodeBuildProject', {
            projectName: `${config.get('environmentname')}-nelson-deployment`,
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
                privileged: true,
                computeType: codebuild.ComputeType.MEDIUM,
            },
            role: nelsonDeplCodeBuildRole,
            vpc: this.nelsonVpc,
            subnetSelection: {
                subnets: this.nelsonVpc.privateSubnets
            },
            securityGroups: [this.fargateClusterSG]
        });
        nelsonDeploymentCodeBuild.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(nelsonDeploymentCodeBuild).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(nelsonDeploymentCodeBuild).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(nelsonDeploymentCodeBuild).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(nelsonDeploymentCodeBuild).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-nelson-deployment-cb`)
        );

        const nelsonDeplBuildOutput = new Artifact('NelsonDeploymentBuildOutput');
        const nelsonDeplBuildAction = new CodeBuildAction({
            actionName: "Build",
            type: CodeBuildActionType.BUILD,
            input: nelsonDeplSourceOutput,
            extraInputs: [nelsonSourceOutput],
            project: nelsonDeploymentCodeBuild,
            outputs: [nelsonDeplBuildOutput],
            environmentVariables: {
                ENV: {
                    value: config.get('environmentname'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                APP_NAME: {
                    value: config.get('saasinfrastructurestack.codebuildenvvariables.appname'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                HOST_PORT: {
                    value: config.get('saasinfrastructurestack.codebuildenvvariables.hostport'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                SERVICE_PORT: {
                    value: config.get('saasinfrastructurestack.codebuildenvvariables.serviceport'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                CPU: {
                    value: config.get('saasinfrastructurestack.codebuildenvvariables.cpu'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                MEMORY: {
                    value: config.get('saasinfrastructurestack.codebuildenvvariables.memory'),
                    type: BuildEnvironmentVariableType.PLAINTEXT
                }
            }
        });

        const deploymentGroup = new EcsDeploymentGroup(this, 'DeploymentGroup', {
            deploymentGroupName: `${config.get('environmentname')}-nelson-deloyment`,
            ecsServices: [ecsService],
            targetGroups: [targetGroup1, targetGroup2],
            prodTrafficListener: prodLisener,
            testTrafficListener: testListener,
            terminationWaitTime: Duration.minutes(100)

        });

        const deployRole = new iam.Role(this, 'DeploymentCBRole', {
            assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
            roleName: `codebuild-${config.get('environmentname')}-deployment-role`,
        });
        deployRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeDeployRoleForECS'));
        deployRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeDeployRoleForECSLimited'));
        deployRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(deployRole).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(deployRole).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(deployRole).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(deployRole).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-nelson-cd-role`)
        );

        const deployAction = new CodeDeployEcsDeployAction({
            actionName: 'Deploy',
            deploymentGroup: deploymentGroup,
            containerImageInputs: [
                {
                    input: nelsonDeplBuildOutput,
                    taskDefinitionPlaceholder: 'IMAGE1_NAME'
                }
            ],
            taskDefinitionTemplateInput: nelsonDeplBuildOutput,
            appSpecTemplateFile: new ArtifactPath(nelsonDeplBuildOutput, 'appspec.yml'),
            role: deployRole
        });

        const codePipelinePolicy = new iam.PolicyStatement({
            actions: [
                'codedeploy:CreateDeployment',
                'codedeploy:GetApplication',
                'codedeploy:GetApplicationRevision',
                'codedeploy:GetDeployment',
                'codedeploy:GetDeploymentConfig',
                'codedeploy:RegisterApplicationRevision',
                'codebuild:BatchGetBuilds',
                'codebuild:StartBuild',
                'codebuild:BatchGetBuildBatches',
                'codebuild:StartBuildBatch',
                'elasticbeanstalk:*',
                'ec2:*',
                'elasticloadbalancing:*',
                'autoscaling:*',
                'cloudwatch:*',
                's3:*',
                'sns:*',
                'cloudformation:*',
                'rds:*',
                'sqs:*',
                'ecs:*'
            ],
            resources: ['*']
        });

        const codePipeLineIAMPolicy = new iam.PolicyStatement({
            actions: [
                'iam:PassRole'
            ],
            resources: ['*'],
            conditions: {
                "StringEqualsIfExists": {
                    "iam:PassedToService": [
                        "cloudformation.amazonaws.com",
                        "elasticbeanstalk.amazonaws.com",
                        "ec2.amazonaws.com",
                        "ecs-tasks.amazonaws.com"
                    ]
                }
            }
        });

        const pipeLineRole = new iam.Role(this, "CodePipeLineRole", {
            assumedBy: new iam.ServicePrincipal("codepipeline.amazonaws.com"),
            roleName: `${config.get('environmentname')}-nelson-deployment-role`
        });
        pipeLineRole.addToPolicy(codePipelinePolicy);
        pipeLineRole.addToPolicy(codePipeLineIAMPolicy);
        pipeLineRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(pipeLineRole).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(pipeLineRole).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(pipeLineRole).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(pipeLineRole).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-nelson-codepipeline-role`)
        );

        const nelsonCodePipelines = new Pipeline(this, 'NelsonCodePipeline', {
            role: pipeLineRole,
            pipelineName: `${config.get('environmentname')}-nelson-deployment`,
            stages: [
                {
                    stageName: 'Source',
                    actions: [nelsonSourceAction, nelsonDeplSourceAction]
                },
                {
                    stageName: 'Build',
                    actions: [nelsonDeplBuildAction]
                },
                {
                    stageName: 'Deploy',
                    actions: [deployAction]
                }
            ],
            artifactBucket: new Bucket(this, 'artifactBucket', {
                autoDeleteObjects: true,
                bucketName: `${config.get('environmentname')}-nelsoncodepipelineartifact`,
                removalPolicy: config.get('defaultremovalpolicy')
            })
        });
        const pipelineCfn = nelsonCodePipelines.node.defaultChild as cdk.CfnResource;
        // addDeletionOverride  removes the property from the cloudformation itself
        // Delete action arn for every stage and action created
        pipelineCfn.addDeletionOverride("Properties.Stages.1.Actions.0.RoleArn");
        pipelineCfn.addDeletionOverride("Properties.Stages.2.Actions.0.RoleArn");
        pipelineCfn.addDeletionOverride("Properties.Stages.3.Actions.0.RoleArn");
        nelsonCodePipelines.artifactBucket.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        nelsonCodePipelines.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(nelsonCodePipelines).add(
            new cdk.Tag('nelson:client', 'saas')
        );
        cdk.Aspects.of(nelsonCodePipelines).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(nelsonCodePipelines).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(nelsonCodePipelines).add(
            new cdk.Tag('Name', `${config.get('environmentname')}-nelson-codepipeline`)
        );
    }
}
