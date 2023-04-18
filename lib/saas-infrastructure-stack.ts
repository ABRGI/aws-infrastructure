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
import { CodeBuildAction, CodeBuildActionType, CodeDeployEcsDeployAction, CodeStarConnectionsSourceAction, GitHubSourceAction, S3SourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Artifact, ArtifactPath, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, IpAddressType, ListenerCertificate, NetworkTargetGroup, TargetType } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Port, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Listener } from 'aws-cdk-lib/aws-globalaccelerator';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import { Cluster, ContainerImage, DeploymentControllerType, FargateService, FargateTaskDefinition, TaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { EcsDeploymentConfig } from 'aws-cdk-lib/aws-codedeploy';
import { ImageRepository  } from '@cloudcomponents/cdk-container-registry';
import { PushImageProject } from '@cloudcomponents/cdk-blue-green-container-deployment';
import { DummyTaskDefinition } from '@cloudcomponents/cdk-blue-green-container-deployment/lib/dummy-task-definition';
import { EcsService, EcsDeploymentGroup } from '@cloudcomponents/cdk-blue-green-container-deployment';
import { Duration } from 'aws-cdk-lib';

export interface VpcStackProps extends cdk.StackProps {
    vpcname?: string
    vpc?: ec2.IVpc
}
export class SaasInfrastructureStack extends cdk.Stack {
    nelsonVpc: ec2.IVpc;
    albSG: ec2.ISecurityGroup; // public security group
    fargateClusterSG: ec2.ISecurityGroup; // private security group
    
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

        // const dbSecurityGroup = new ec2.SecurityGroup(this, "dbSecurityGroup", {
        //     vpc: this.nelsonVpc,
        //     allowAllOutbound: true,
        //     description: "Security group for RDS",
        //     securityGroupName: `${config.get('environmentname')}-db-sg`
        //   });
        // for (const privateSubnet of this.nelsonVpc.privateSubnets) {
        //     console.log('SG' + privateSubnet.ipv4CidrBlock);
        //     dbSecurityGroup.addIngressRule(ec2.Peer.ipv4(privateSubnet.ipv4CidrBlock), ec2.Port.tcp(5432), 'Receive all traffics from internet via port 443');
        // }
        // dbSecurityGroup.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        // // Create nelson DB
        // const nelsonDB = new rds.DatabaseCluster(this, 'Database', {
        //     engine: rds.DatabaseClusterEngine.auroraPostgres({version: rds.AuroraPostgresEngineVersion.VER_13_7}),
        //     instanceProps: {
        //         vpc: this.nelsonVpc,
        //         vpcSubnets: {
        //             subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        //         },
        //         securityGroups: [dbSecurityGroup],
        //         publiclyAccessible: false
        //     },
        //     defaultDatabaseName: 'nelson',
        //     instances: 1,
        //     instanceIdentifierBase: `${config.get('environmentname')}-saas-nelson-services-db-instance-`,
        //     credentials: rds.Credentials.fromSecret(Secret.fromSecretNameV2(this, 'DBCredential', 'cdkRDSCredential')),
        //     removalPolicy: config.get('defaultremovalpolicy'),
        //     clusterIdentifier: `${config.get('environmentname')}-saas-nelson-services-db-cluster`
        // });



        // Create ALB
        const alb = new ApplicationLoadBalancer(this, 'ALB', {
            vpc: this.nelsonVpc,
            internetFacing: true,
            loadBalancerName: `${config.get('environmentname')}`,
            securityGroup: this.albSG,
            vpcSubnets: {
                subnetType: SubnetType.PUBLIC
            },
            ipAddressType: IpAddressType.IPV4
        });

        // const autoScalingGroup1 = new AutoScalingGroup(this, '', {
        //     vpc: this.nelsonVpc,
        //     instanceType: new ec2.InstanceType()
        // });
        //const autoScalingGroup2 = new AutoScalingGroup();
        // *.nelson.management
        
        
        const targetGroup1 = new ApplicationTargetGroup(this, 'TG1', {
            port: 80,
            protocol: ApplicationProtocol.HTTP,
            targetType: TargetType.IP,
            vpc: this.nelsonVpc,
            targetGroupName: `${config.get('environmentname')}-tg-01`,
            healthCheck: {
                path: '/status'
            }
        });
        const prodLisener = alb.addListener('ProdListener', {
            port: 443,
            certificates: [ListenerCertificate.fromArn('arn:aws:acm:eu-central-1:459045743560:certificate/23fb79fa-0ab6-4c82-baa8-697d963ba824')],
            protocol: ApplicationProtocol.HTTPS,
            defaultTargetGroups: [targetGroup1]
        });
        prodLisener.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        

        const targetGroup2 = new ApplicationTargetGroup(this, 'TG2', {
            port: 80,
            protocol: ApplicationProtocol.HTTP,
            targetType: TargetType.IP,
            vpc: this.nelsonVpc,
            targetGroupName: `${config.get('environmentname')}-tg-02`,
            healthCheck: {
                path: '/status'
            }
        });

        const testListener = alb.addListener('Testistener', {
            port: 8443,
            certificates: [ListenerCertificate.fromArn('arn:aws:acm:eu-central-1:459045743560:certificate/23fb79fa-0ab6-4c82-baa8-697d963ba824')],
            protocol: ApplicationProtocol.HTTPS,
            defaultTargetGroups: [targetGroup2],
        });

        testListener.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        alb.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        // Create ECSCluster

        const cluster = new Cluster(this, 'FargateCluster', {
            clusterName: config.get('environmentname'),
            vpc: this.nelsonVpc
        });

        // This task definition will be replaced by codedeploy in Codepipeline
        // const taskDefition = new FargateTaskDefinition(this, 'TD', {
        // });
        // taskDefition.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        const taskDefinition = new DummyTaskDefinition(this, 'DummyTaskDefinition', {
            image: 'nginx',
            family: 'blue-green',
          });

        const repository = new Repository(this, 'ECR', {
            repositoryName: 'test/nelson',
            removalPolicy: config.get('defaultremovalpolicy')
        });

        const ecsService = new EcsService(this, 'EcsService', {
            cluster: cluster,
            serviceName: 'nelson',
            desiredCount: 2,
            taskDefinition: taskDefinition,
            prodTargetGroup: targetGroup1,
            testTargetGroup: targetGroup2
        });

        ecsService.connections.allowFrom(alb, Port.tcp(443));
        ecsService.connections.allowFrom(alb, Port.tcp(8443));

        // const container = taskDefition.addContainer('Container', {
        //     image: ContainerImage.fromEcrRepository(repository),
        //     portMappings: [
        //         {
        //             containerPort: 80,
        //             hostPort: 80
        //         }
        //     ]
        // });
        cluster.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        // const fargateService = new FargateService(this, 'FargateService', {
        //     cluster: cluster,
        //     taskDefinition: taskDefition,
        //     assignPublicIp: false,
        //     securityGroups: [this.fargateClusterSG],
        //     serviceName: 'nelson',
        //     vpcSubnets: {
        //         subnetType: SubnetType.PRIVATE_WITH_EGRESS
        //     },
        //     deploymentController: {
        //         type: DeploymentControllerType.CODE_DEPLOY
        //     },
        //     desiredCount: 2
        // });
        // fargateService.attachToApplicationTargetGroup(targetGroup1);
        // fargateService.attachToApplicationTargetGroup(targetGroup2);
        // fargateService.connections.allowFrom(alb, Port.tcp(443));
        // fargateService.connections.allowFrom(alb, Port.tcp(8443));
        // fargateService.applyRemovalPolicy(config.get('defaultremovalpolicy'));


        // Create code build
        const nelsonCodeBuildRole = new iam.Role(this, 'NelsonCBRole', {
            roleName: `codebuild-${config.get('environmentname')}-nelson-service-role`,
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com')
        });
        nelsonCodeBuildRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        nelsonCodeBuildRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryFullAccess'));
        nelsonCodeBuildRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        const nelsonCodeBuildSource = codebuild.Source.gitHub({
            owner: 'ABRGI',
            repo: 'nelson',
            branchOrRef: 'develop',
            webhook: true,
            webhookTriggersBatchBuild: false,
            webhookFilters: [
                codebuild.FilterGroup
                    .inEventOf(codebuild.EventAction.PUSH)
                    .andBranchIs('develop'),
                codebuild.FilterGroup
                    .inEventOf(codebuild.EventAction.PULL_REQUEST_MERGED)
                    .andHeadRefIs('^refs/heads/*$')
                    .andBaseRefIs('^refs/heads/develop$')
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
        });
        nelsonCodeBuildProject.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        // Create code pipelines
        const nelsonSourceOutput = new Artifact('NelsonSourceOutput');
        const nelsonDeplSourceOutput = new Artifact('NelsonDeploymentSourceOutput');

        // Create nelson code pipelines
        const nelsonSourceAction = new S3SourceAction({
            actionName: 'nelson',
            bucket: artifactBucket,
            bucketKey: `${config.get('environmentname')}/nelson`,
            output: nelsonSourceOutput
        });

        const nelsonDeplSourceAction = new CodeStarConnectionsSourceAction({
            actionName: 'Source',
            owner: 'ABRGI',
            repo: 'nelson-deployment',
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

        const nelsonDeploymentCodeBuild = new PipelineProject(this, 'NelsonDeploymentCodeBuildProject', {
            projectName: `${config.get('environmentname')}-nelson-deployment`,
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
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
                    value: 'stg-omena',
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                APP_NAME: {
                    value: 'nelson',
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                MAJOR_VERSION_NUMBER: {
                    value: '2',
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                MINOR_VERSION_NUMBER: {
                    value: '12',
                    type: BuildEnvironmentVariableType.PLAINTEXT
                },
                REPO: {
                    value: 'SNAPSHOT',
                    type: BuildEnvironmentVariableType.PLAINTEXT
                }
            }
        });

        // const deploymentGroup = new EcsDeploymentGroup(this, 'DeploymentGroup', {
        //     deploymentGroupName: `${config.get('environmentname')}-nelson-deloyment`,
        //     service: fargateService,
        //     blueGreenDeploymentConfig: {
        //         blueTargetGroup: targetGroup1,
        //         greenTargetGroup: targetGroup2,
        //         listener: prodLisener,
        //         testListener: testListener
        //     },
        //     deploymentConfig: EcsDeploymentConfig.ALL_AT_ONCE
        // });
        // deploymentGroup.applyRemovalPolicy(config.get('defaultremovalpolicy'));


        const deploymentGroup = new EcsDeploymentGroup(this, 'DeploymentGroup', {
            deploymentGroupName: `${config.get('environmentname')}-nelson-deloyment`,
            ecsServices: [ecsService],
            targetGroups: [targetGroup1, targetGroup2],
            prodTrafficListener: prodLisener,
            testTrafficListener: testListener,
            terminationWaitTime: Duration.minutes(100),

        });
        //deploymentGroup.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        const deployRole = new iam.Role(this, 'DeploymentCBRole', {
            assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
            roleName: `codebuild-${config.get('environmentname')}-deployment-role`,
        });
        deployRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeDeployRoleForECS'));
        deployRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeDeployRoleForECSLimited'));
        deployRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));

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
            appSpecTemplateInput: nelsonDeplBuildOutput,
            role: deployRole
            //role: iam.Role.fromRoleArn(this,  'DMRole','arn:aws:iam::459045743560:role/ecsCodeDeployRole')
        });
        const pipeLineRole = new iam.Role(this, "CodePipeLineRole", {
            assumedBy: new iam.ServicePrincipal("codepipeline.amazonaws.com"),
        });

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
                // Add Deploy state
            ]
        });
        const pipelineCfn = nelsonCodePipelines.node.defaultChild as cdk.CfnResource;
        // addDeletionOverride  removes the property from the cloudformation itself
        // Delete action arn for every stage and action created
        pipelineCfn.addDeletionOverride("Properties.Stages.1.Actions.0.RoleArn");
        pipelineCfn.addDeletionOverride("Properties.Stages.2.Actions.0.RoleArn");
        pipelineCfn.addDeletionOverride("Properties.Stages.3.Actions.0.RoleArn");
        nelsonCodePipelines.applyRemovalPolicy(config.get('defaultremovalpolicy'));

    }
}
