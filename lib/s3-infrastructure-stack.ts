import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as config from 'config';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class S3InfrastructureStack extends cdk.Stack {
    nelsonS3Bucket: s3.Bucket;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Step1: Initialize S3 bucket
        this.nelsonS3Bucket = new s3.Bucket(this, `S3`, {
            bucketName: config.get('bucketname'),
            removalPolicy: config.get('defaultremovalpolicy'),
            publicReadAccess: config.get('publicreadaccess'),
            //Block all public access: off
            blockPublicAccess: new s3.BlockPublicAccess({blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false})
        });

        // Step2: Create a policy statement
        const policyStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject'
            ],
            resources: [`${this.nelsonS3Bucket.bucketArn}/*`],
        });

        // Step3: Add the policy statement for the bucket
        this.nelsonS3Bucket.addToResourcePolicy(policyStatement);

        //Step4: Re-tagging for S3 bucket
        cdk.Aspects.of(this.nelsonS3Bucket).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(this.nelsonS3Bucket).add(
            new cdk.Tag('nelson:role', 'service')
        );

        cdk.Aspects.of(this.nelsonS3Bucket).add(
            new cdk.Tag('nelson:environment', 'saas')
        );
    }
}