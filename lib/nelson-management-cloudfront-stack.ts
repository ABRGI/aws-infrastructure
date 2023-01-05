/*
    This stack configures the cloudfront distribution for Nelson Management

    Dependency:
    - Expects a hosted zone to be created in Route53 with the certificate added as CNAME record for the domain/sub-domain
    - Expects MUI bucket to be created already as it uses the name to look for the bucket. Can be deployed through MUI stack in aws-infrastructure
    - Note: As the cloudfront api doesn't support ammending an existing distribution, we have to include all configs within this stack
*/

import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontAllowedCachedMethods, CloudFrontAllowedMethods, CloudFrontWebDistribution, ViewerCertificate, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { Duration } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';

export interface NelsonCloudFrontStackProps extends cdk.StackProps {
    hostedZone: IHostedZone,
    viewerAcmCertificateArn: string,
    userManagementApiGatewayRestApiId: string,
    tenantManagementApiGatewayRestApiID: string,
    apiGatewayRegion: string,
    muiBucket?: IBucket
}

export class NelsonManagementCloudFrontStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: NelsonCloudFrontStackProps) {
        super(scope, id, props);
        const certificate = Certificate.fromCertificateArn(this, 'NelsonManagementDomainCertificate', props.viewerAcmCertificateArn);
        //Step 1: Create cloudfront distribution
        const nelsonCfDistribution = new CloudFrontWebDistribution(this, 'NelsonManagementCFDistribution', {
            comment: `${config.get('domain')}`,
            originConfigs: [
                //User management API
                {
                    connectionTimeout: Duration.seconds(5),
                    customOriginSource: {
                        domainName: `${props.userManagementApiGatewayRestApiId}.execute-api.${props.apiGatewayRegion}.${this.urlSuffix}`,
                        originPath: `/${config.get('environmentname')}`
                    },
                    behaviors: [
                        {
                            //User management service behavior
                            pathPattern: '/api/user/*',
                            compress: false,
                            isDefaultBehavior: false,
                            allowedMethods: CloudFrontAllowedMethods.ALL,
                            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                            forwardedValues: {
                                headers: ['Authorization'],
                                queryString: true,
                            },
                            cachedMethods: CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
                            minTtl: Duration.seconds(0),
                            maxTtl: Duration.seconds(0),
                            defaultTtl: Duration.seconds(0)
                        }]
                },
                //S3 redirect for static website
                {
                    connectionTimeout: Duration.seconds(5),
                    s3OriginSource: {
                        s3BucketSource: props.muiBucket ?? Bucket.fromBucketName(this, 'MuiBucket', config.get('muiinfrastructurestack.bucketname')),
                        originPath: '/portal'
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
                //Tenant management API
                {
                    connectionTimeout: Duration.seconds(5),
                    customOriginSource: {
                        domainName: `${props.tenantManagementApiGatewayRestApiID}.execute-api.${props.apiGatewayRegion}.${this.urlSuffix}`,
                        originPath: `/${config.get('environmentname')}`
                    },
                    behaviors: [
                        {
                            //User management service behavior
                            pathPattern: '/api/tenant/*',
                            compress: false,
                            isDefaultBehavior: false,
                            allowedMethods: CloudFrontAllowedMethods.ALL,
                            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                            forwardedValues: {
                                headers: ['Authorization'],
                                queryString: true,
                            },
                            cachedMethods: CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
                            minTtl: Duration.seconds(0),
                            maxTtl: Duration.seconds(0),
                            defaultTtl: Duration.seconds(0)
                        }]
                },
            ],
            viewerCertificate: ViewerCertificate.fromAcmCertificate(certificate, {
                aliases: [config.get('domain')]
            })
        });
        nelsonCfDistribution.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        //Route domain/sub-domain to cloudfront distribution - Add ARecord in hosted zone
        new ARecord(this, 'NelsonManagementCloudFrontARecord', {
            zone: props.hostedZone,
            recordName: String(config.get('domain')).split(`.${config.get('hostedzonestack.hostedzone')}`)[0],  //Get only the subdomain value
            comment: config.get('domain'),
            ttl: Duration.minutes(5),
            target: RecordTarget.fromAlias(new CloudFrontTarget(nelsonCfDistribution))
        }).applyRemovalPolicy(config.get('defaultremovalpolicy'));

        //Tag the cloudfront distribution
        cdk.Aspects.of(nelsonCfDistribution).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(nelsonCfDistribution).add(
            new cdk.Tag('nelson:role', `nelson-management-cloudfront-dist`)
        );
        cdk.Aspects.of(nelsonCfDistribution).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
    }
}