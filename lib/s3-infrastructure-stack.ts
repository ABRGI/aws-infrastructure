import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as config from 'config';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { IBucket } from 'aws-cdk-lib/aws-s3';

export class S3InfrastructureStack extends cdk.Stack {
    buiS3Bucket: IBucket;
    muiS3Bucket: IBucket;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Step1: Check BUI bucket exists or not, if it exists, will get it, otherwise create a new one
        if (config.get('nelsonsaasbucket.useexistingbuibucket') == false) {
            
            //Step1.1: Initialize BUI bucket
            this.buiS3Bucket = new s3.Bucket(this, `BUIS3`, {
                bucketName: config.get('nelsonsaasbucket.buibucketname'),
                removalPolicy: config.get('defaultremovalpolicy'),
                publicReadAccess: config.get('nelsonsaasbucket.publicreadaccess'),
                //Block all public access: off
                blockPublicAccess: new s3.BlockPublicAccess({blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false})
            });
    
            // Step1.2: Create a policy statement
            const buiPolicyStatement = new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    's3:GetObject'
                ],
                resources: [`${this.buiS3Bucket.bucketArn}/*`],
            });
    
            // Step1.3: Add the policy statement for the bucket
            this.buiS3Bucket.addToResourcePolicy(buiPolicyStatement);
    
            //Step1.4: Re-tagging for S3 bucket
            cdk.Aspects.of(this.buiS3Bucket).add(
                new cdk.Tag('nelson:client', config.get('environmentname'))
            );
            cdk.Aspects.of(this.buiS3Bucket).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(this.buiS3Bucket).add(
                new cdk.Tag('nelson:environment', 'saas')
            );
        } else {
            // Get existing BUI bucket
            this.buiS3Bucket = s3.Bucket.fromBucketName(this, 'BUIS3', config.get('nelsonsaasbucket.buibucketname'));
        }

        // Step2: Check MUI bucket exists or not, if it exists, will get it, otherwise create a new one
        if (config.get('nelsonsaasbucket.useexistingmuibucket') == false) {
            
            //Step2.1: Initialize MUI bucket
            this.muiS3Bucket = new s3.Bucket(this, `MUIS3`, {
                bucketName: config.get('nelsonsaasbucket.muibucketname'),
                removalPolicy: config.get('defaultremovalpolicy'),
                publicReadAccess: config.get('nelsonsaasbucket.publicreadaccess'),
                //Block all public access: off
                blockPublicAccess: new s3.BlockPublicAccess({blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false})
            });
    
            // Step2.2: Create a policy statement
            const muiPolicyStatement = new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    's3:GetObject'
                ],
                resources: [`${this.muiS3Bucket.bucketArn}/*`],
            });
    
            // Step2.3: Add the policy statement for the bucket
            this.muiS3Bucket.addToResourcePolicy(muiPolicyStatement);
    
            //Step2.4: Re-tagging for S3 bucket
            cdk.Aspects.of(this.muiS3Bucket).add(
                new cdk.Tag('nelson:client', config.get('environmentname'))
            );
            cdk.Aspects.of(this.muiS3Bucket).add(
                new cdk.Tag('nelson:role', 'service')
            );
            cdk.Aspects.of(this.muiS3Bucket).add(
                new cdk.Tag('nelson:environment', 'saas')
            );
        } else {
            // Get existing BUI bucket
            this.muiS3Bucket = s3.Bucket.fromBucketName(this, 'MUIS3', config.get('nelsonsaasbucket.muibucketname'));
        }
    }
}