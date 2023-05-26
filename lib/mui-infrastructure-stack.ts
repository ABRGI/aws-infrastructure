import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as config from 'config';
import { Construct } from 'constructs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, CodeStarConnectionsSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { BuildEnvironmentVariableType, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { ISecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';

export interface MuiStackProps extends cdk.StackProps {
    vpc?: IVpc;
    privateSG?: ISecurityGroup;
}
export class MuiInfrastructureStack extends cdk.Stack {
    muiBucket: IBucket;
    vpc: IVpc;

    constructor(scope: Construct, id: string, props?: MuiStackProps) {
        super(scope, id, props);
        this.vpc = props?.vpc!;
        //Step 1 Initialize MUI bucket
        this.muiBucket = new s3.Bucket(this, `MuiBucket`, {
            bucketName: config.get('muiinfrastructurestack.bucketname'),
            removalPolicy: config.get('defaultremovalpolicy'),
            publicReadAccess: config.get('muiinfrastructurestack.publicreadaccess'),
            autoDeleteObjects: true,
            //Block all public access: off
            blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false })
        });
        this.muiBucket.grantPublicAccess();

        //Step 2: Re-tagging for S3 bucket
        cdk.Aspects.of(this.muiBucket).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(this.muiBucket).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(this.muiBucket).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );




        // Create MUI codepipeline steps
        // Declare sourceOuput and buildOutput to store the artifacts of source and build states
        const sourceOutput = new Artifact('SourceOutput');
        const buildOutput = new Artifact('BuildOutput')

        // Creating source action with getting the source code from github
        const sourceAction = new CodeStarConnectionsSourceAction({
            actionName: 'Source',
            owner: config.get('muiinfrastructurestack.owner'),
            repo: config.get('muiinfrastructurestack.repo'),
            branch: config.get('muiinfrastructurestack.branch'),
            output: sourceOutput,
            connectionArn: config.get('connectionarn')
        });

        // Create a MUI custom policy to get the access to S3 bucket that will be stored bui static files
        const muiCodeBuildS3Policy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject',
                's3:PutObject',
                's3:ListBucket',
                's3:DeleteObject'
            ],
            resources: [
                `${this.muiBucket.bucketArn}/*`,
                `${this.muiBucket.bucketArn}`
            ]
        });

        // Create codebuild role for MUI codebuild project
        const muiCodeBuildRole = new iam.Role(this, 'MUIRole', {
            roleName: `codebuild-${config.get('environmentname')}-nelson-management-ui-service-role`,
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com')
        });
        // Add BUI custom policy for role
        muiCodeBuildRole.addToPolicy(muiCodeBuildS3Policy);
        muiCodeBuildRole.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        // Create codebuildproject to build and upload static files to S3 bucket
        const muiCodeBuildProject = new PipelineProject(this, `MUICodeBuild`, {
            projectName: `${config.get('environmentname')}-nelson-management-ui`,
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
                privileged: true,
                computeType: codebuild.ComputeType.MEDIUM,
            },
            role: muiCodeBuildRole,
            vpc: this.vpc,
            subnetSelection: {
                subnets: this.vpc.privateSubnets
            },
            //securityGroups: [SecurityGroup.fromLookupByName(this, 'SG', `${config.get('environmentname')}-fargate-cluster-sg`, this.vpc as Vpc)]
        });
        // Add removal policy for codebuild
        muiCodeBuildProject.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        
        const buildAction = new CodeBuildAction({
            actionName: "Build",
            input: sourceOutput,
            project: muiCodeBuildProject,
            outputs: [buildOutput],
            environmentVariables: {
                HOTEL_BUILD: {
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                    value: config.get('muiinfrastructurestack.hotelbuild'),
                },
                S3_BUCKET: {
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                    value: config.get('muiinfrastructurestack.bucketname')
                },
                RELEASE_VERSION: {
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                    value: config.get('muiinfrastructurestack.releaseversion')
                },
                ROOT_FOLDER: {
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                    value: config.get('muiinfrastructurestack.rootfolder')
                }
                
            }
        });

        const buiCodePipeline = new Pipeline(this, 'CodePipelines', {
            pipelineName: `${config.get('environmentname')}-nelson-management-ui`,
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