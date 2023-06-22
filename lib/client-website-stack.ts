import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';

//TODO: update the cloudfront stack to point to the client website.
export class ClientWebsiteStack extends cdk.Stack {
    websiteBucket: cdk.aws_s3.Bucket;
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        this.websiteBucket = new Bucket(this, 'WebsiteBucket', {
            bucketName: config.get('clientwebsite.bucketname'),
            removalPolicy: config.get('defaultremovalpolicy'),
            publicReadAccess: true,
            blockPublicAccess: new BlockPublicAccess({
                blockPublicAcls: false,
                blockPublicPolicy: false,
                ignorePublicAcls: false,
                restrictPublicBuckets: false
            })
        });
        const websitePolicyStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject'
            ],
            resources: [`${this.websiteBucket.bucketArn}/*`]
        });
        this.websiteBucket.addToResourcePolicy(websitePolicyStatement);
        //Tag the cloudfront distribution
        cdk.Aspects.of(this.websiteBucket).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(this.websiteBucket).add(
            new cdk.Tag('nelson:role', `${config.get('tags.nelsonroleprefix')}-website`)
        );
        cdk.Aspects.of(this.websiteBucket).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
    }
}