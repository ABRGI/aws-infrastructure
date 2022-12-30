import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as config from 'config';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { IBucket } from 'aws-cdk-lib/aws-s3';

export class BuiInfrastructureStack extends cdk.Stack {
    buiBucket: IBucket;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        //Step 1 Initialize BUI bucket
        this.buiBucket = new s3.Bucket(this, `BuiBucket`, {
            bucketName: config.get('buiinfrastructurestack.bucketname'),
            removalPolicy: config.get('defaultremovalpolicy'),
            publicReadAccess: config.get('buiinfrastructurestack.publicreadaccess'),
            //Block all public access: off
            blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false })
        });

        // Step 2 Create a policy statement
        const buiPolicyStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject'
            ],
            resources: [`${this.buiBucket.bucketArn}/*`],
        });

        // Step 3 Add the policy statement for the bucket
        this.buiBucket.addToResourcePolicy(buiPolicyStatement);

        //Step 4 Re-tagging for S3 bucket
        cdk.Aspects.of(this.buiBucket).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(this.buiBucket).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(this.buiBucket).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );
    }
}