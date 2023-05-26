import * as cdk from 'aws-cdk-lib';
import { CloudFrontAllowedCachedMethods, CloudFrontAllowedMethods, CloudFrontWebDistribution, ViewerCertificate, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as config from 'config';

export interface BuiCloudFrontStackProps extends cdk.StackProps {
    hostedZone: IHostedZone,
    viewerAcmCertificateArn: string,
    buiBucket: IBucket,
    loadBalancerDnsName: string;
}

export class BuiCloudFrontStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props: BuiCloudFrontStackProps) {
        super(scope, id, props);

        const certificate = Certificate.fromCertificateArn(this, 'NelsonBUIDomainCertificate', props.viewerAcmCertificateArn);
        //Step 1: Create cloudfront distribution
        const nelsonCfDistribution = new CloudFrontWebDistribution(this, 'NelsonBUICFDistribution', {
            comment: `${config.get('domain')}`,
            originConfigs: [
                //S3 redirect for static website
                {
                    connectionTimeout: Duration.seconds(5),
                    s3OriginSource: {
                        s3BucketSource: props.buiBucket ?? Bucket.fromBucketName(this, 'buiBucket', config.get('muiinfrastructurestack.bucketname')),
                        originPath: '/'
                    },
                    behaviors: [
                        //Default behavior
                        {
                            isDefaultBehavior: true,
                            allowedMethods: CloudFrontAllowedMethods.GET_HEAD,
                            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS
                        }
                    ]
                },
                {
                    connectionTimeout: Duration.seconds(5),
                    customOriginSource: {
                        domainName: props.loadBalancerDnsName
                    },
                    behaviors: [
                        //Default behavior
                        {  
                            pathPattern: '/api/*',
                            isDefaultBehavior: false,
                            allowedMethods: CloudFrontAllowedMethods.ALL,
                            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS
                        }
                    ]
                    
                }
            ],
            viewerCertificate: ViewerCertificate.fromAcmCertificate(certificate, {
                aliases: [config.get('domain')]
            })
        });
        nelsonCfDistribution.applyRemovalPolicy(config.get('defaultremovalpolicy'));

    }
}