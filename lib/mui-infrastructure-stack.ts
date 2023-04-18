import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as config from 'config';
import { Construct } from 'constructs';
import { IBucket } from 'aws-cdk-lib/aws-s3';

export class MuiInfrastructureStack extends cdk.Stack {
    muiBucket: IBucket;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

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
    }
}  