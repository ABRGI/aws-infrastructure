import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as config from 'config';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, CodeStarConnectionsSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { BuildEnvironmentVariableType, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2'


export interface BuiStackProps extends cdk.StackProps {
    vpc: IVpc;
    privateSG: ISecurityGroup;
}
export class BuiInfrastructureStack extends cdk.Stack {
    buiBucket: IBucket;
    vpc: IVpc;

    constructor(scope: Construct, id: string, props?: BuiStackProps) {
        super(scope, id, props);
        this.vpc = props?.vpc!;
        // Initialize BUI bucket
        this.buiBucket = new s3.Bucket(this, `BuiBucket`, {
            bucketName: config.get('buiinfrastructurestack.bucketname'),
            removalPolicy: config.get('defaultremovalpolicy'),
            publicReadAccess: config.get('buiinfrastructurestack.publicreadaccess'),
            autoDeleteObjects: true,
            //Block all public access: off
            blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false })
        });

        // Create BUI policy statement
        const buiPolicyStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject'
            ],
            resources: [`${this.buiBucket.bucketArn}/*`],
        });

        // Add the policy statement for the bucket
        this.buiBucket.addToResourcePolicy(buiPolicyStatement);

        // Re-tagging for S3 bucket
        cdk.Aspects.of(this.buiBucket).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(this.buiBucket).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(this.buiBucket).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );


        // Create BUI codepipeline steps
        // Declare sourceOuput and buildOutput to store the artifacts of source and build states
        const sourceOutput = new Artifact('SourceOutput');
        const buildOutput = new Artifact('BuildOutput')

        // Creating source action with getting the source code from github
        const sourceAction = new CodeStarConnectionsSourceAction({
            actionName: 'Source',
            owner: config.get('buiinfrastructurestack.owner'),
            repo: config.get('buiinfrastructurestack.repo'),
            branch: config.get('buiinfrastructurestack.branch'),
            output: sourceOutput,
            connectionArn: config.get('connectionarn')
        });

        // Create a BUI custom policy to get the access to S3 bucket that will be stored bui static files
        const buiCodeBuildS3Policy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject',
                's3:PutObject',
                's3:ListBucket',
                's3:DeleteObject'
            ],
            resources: [
                `${this.buiBucket.bucketArn}/*`,
                `${this.buiBucket.bucketArn}`
            ]
        });

        // Create codebuild role for BUI codebuild project
        const buiCodeBuildRole = new iam.Role(this, 'BUIRole', {
            roleName: `codebuild-${config.get('environmentname')}-nelson-bui-2_0-service-role`,
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com')
        });
        // Add BUI custom policy for role
        buiCodeBuildRole.addToPolicy(buiCodeBuildS3Policy);
        buiCodeBuildRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        // Create codebuildproject to build and upload static files to S3 bucket
        const buiCodeBuildProject = new PipelineProject(this, `BUICodeBuild`, {
            projectName: `${config.get('environmentname')}-nelson-bui-2_0`,
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
                privileged: true,
                computeType: codebuild.ComputeType.MEDIUM,
            },
            role: buiCodeBuildRole,
            vpc: this.vpc,
            subnetSelection: {
                subnets: this.vpc.privateSubnets
            },
            //securityGroups: [SecurityGroup.fromLookupByName(this, 'SG', `${config.get('environmentname')}-fargate-cluster-sg`, this.vpc as Vpc)]
        });
        // Add removal policy for codebuild
        buiCodeBuildProject.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        
        const buildAction = new CodeBuildAction({
            actionName: "Build",
            input: sourceOutput,
            project: buiCodeBuildProject,
            outputs: [buildOutput],
            environmentVariables: {
                HOTEL_BUILD: {
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                    value: config.get('buiinfrastructurestack.hotelbuild'),
                },
                LOCALES: {
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                    value: config.get('buiinfrastructurestack.locales')
                },
                HOTEL_CHAIN_NAME: {
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                    value: config.get('buiinfrastructurestack.hotelchainname')
                },
                S3_BUCKET: {
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                    value: config.get('buiinfrastructurestack.bucketname')
                },
                RELEASE_VERSION: {
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                    value: config.get('buiinfrastructurestack.releaseversion')
                }
            }
        });

        const buiCodePipeline = new Pipeline(this, 'CodePipelines', {
            pipelineName: `${config.get('environmentname')}-nelson-bui-2_0`,
            stages: [
                {
                    stageName: "Source",
                    actions: [sourceAction]
                },
                {
                    stageName: "Build",
                    actions: [buildAction]
                }
            ]
        });
        buiCodePipeline.applyRemovalPolicy(config.get('defaultremovalpolicy'));
    }
}