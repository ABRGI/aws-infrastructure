import * as cdk from 'aws-cdk-lib';
import { CloudFrontAllowedCachedMethods, CloudFrontAllowedMethods, CloudFrontWebDistribution, OriginProtocolPolicy, ViewerCertificate, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as config from 'config';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';

export interface BuiCloudFrontStackProps extends cdk.StackProps {
    hostedZone: IHostedZone,
    viewerAcmCertificateArn: string,
    buiBucketName: IBucket,
    loadBalancerDnsName: string;
}

export class BuiCloudFrontStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props: BuiCloudFrontStackProps) {
        super(scope, id, props);
        const certificate = Certificate.fromCertificateArn(this, 'NelsonBuiDomainCertificate', props.viewerAcmCertificateArn);
        //Step 1: Create cloudfront distribution
        console.log('BUI BUCKET: ' + props.buiBucketName);
        console.log(this.region);
        const nelsonCfDistribution = new CloudFrontWebDistribution(this, 'NelsonBuiCFDistribution', {
            comment: `${config.get('buihostedzonestack.domain')}`,
            originConfigs: [
                //S3 redirect for static website
                {
                    connectionTimeout: Duration.seconds(5),
                    customOriginSource: {
                        domainName: `${config.get('buiinfrastructurestack.bucketname')}.s3-website.${this.region}.amazonaws.com`,
                        originProtocolPolicy: OriginProtocolPolicy.HTTP_ONLY
                    },
                    behaviors: [
                        //Default behavior
                        {
                            isDefaultBehavior: true,
                            allowedMethods: CloudFrontAllowedMethods.GET_HEAD,
                            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                            
                            
                        }
                    ]
                },
                //User management API
                {
                    connectionTimeout: Duration.seconds(5),
                    customOriginSource: {
                        domainName: config.get('nelsonmanagementservice.userserviceapigatewayurl'),
                        originPath: config.get('nelsonmanagementservice.userserviceoriginpath')
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
                //Tenant management API
                {
                    connectionTimeout: Duration.seconds(5),
                    customOriginSource: {
                        domainName: config.get('nelsonmanagementservice.tenantserviceapigatewayurl'),
                        originPath: config.get('nelsonmanagementservice.tenantserviceoriginpath')
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
                // SAAS API
                {
                    connectionTimeout: Duration.seconds(5),
                    customOriginSource: {
                        domainName: props.loadBalancerDnsName,

                    },
                    behaviors: [
                        {  
                            pathPattern: '/api/*',
                            isDefaultBehavior: false,
                            allowedMethods: CloudFrontAllowedMethods.ALL,
                            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS
                        }
                    ],
                    
                },
                //tenants
                {
                    connectionTimeout: Duration.seconds(5),
                    customOriginSource: {
                        domainName: config.get('tenantproperties.bucketname'),
                        originPath: config.get('tenantproperties.originpath')
                    },
                    behaviors: [
                        {
                            //User management service behavior
                            pathPattern: '/*-config.json',
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
                //tenants
                {
                    connectionTimeout: Duration.seconds(5),
                    customOriginSource: {
                        domainName: config.get('tenantproperties.bucketname'),
                        originPath: config.get('tenantproperties.originpath')
                    },
                    behaviors: [
                        {
                            //User management service behavior
                            pathPattern: '/config.txt',
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
                }
            ],
            viewerCertificate: ViewerCertificate.fromAcmCertificate(certificate, {
                aliases: [props.buiBucketName.bucketName]
            })
        });
        nelsonCfDistribution.applyRemovalPolicy(config.get('defaultremovalpolicy'));

         //Route domain/sub-domain to cloudfront distribution - Add ARecord in hosted zone
         new ARecord(this, 'NelsonBuiCloudFrontARecord', {
            zone: props.hostedZone,
            recordName: String(config.get('buihostedzonestack.domain')).split(`.${config.get('buihostedzonestack.hostedzone')}`)[0],  //Get only the subdomain value
            comment: props.buiBucketName.bucketName,
            ttl: Duration.minutes(5),
            target: RecordTarget.fromAlias(new CloudFrontTarget(nelsonCfDistribution))
        }).applyRemovalPolicy(config.get('defaultremovalpolicy'));

        //Tag the cloudfront distribution
        cdk.Aspects.of(nelsonCfDistribution).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(nelsonCfDistribution).add(
            new cdk.Tag('nelson:role', `${config.get('tags.nelsonroleprefix')}-cloudfront-dist`)
        );
        cdk.Aspects.of(nelsonCfDistribution).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
    }
}