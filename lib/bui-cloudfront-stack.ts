import * as cdk from 'aws-cdk-lib';
import { AllowedMethods, CacheHeaderBehavior, CachePolicy, CloudFrontAllowedCachedMethods, CloudFrontAllowedMethods, CloudFrontWebDistribution, Distribution, OriginProtocolPolicy, OriginRequestPolicy, OriginRequestQueryStringBehavior, ViewerCertificate, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { ARecord, CfnRecordSet, CnameRecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as config from 'config';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { HttpOrigin, LoadBalancerV2Origin, S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { ApplicationLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ses from 'aws-cdk-lib/aws-ses';

export interface BuiCloudFrontStackProps extends cdk.StackProps {
    hostedZone: IHostedZone,
    viewerAcmCertificateArn: string,
    buiBucket: IBucket,
    loadBalancer: ApplicationLoadBalancer,
    clientWebsiteBucket?: IBucket
}

export class BuiCloudFrontStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props: BuiCloudFrontStackProps) {
        var useClientDomain = config.get('buihostedzonestack.useclientdomain');
        if (useClientDomain == true && !props.clientWebsiteBucket) {
            throw ('Expecting client website bucket');
        }
        super(scope, id, props);
        const certificate = Certificate.fromCertificateArn(this, 'NelsonBuiDomainCertificate', props.viewerAcmCertificateArn);
        //Define origin and behavior policies
        var behaviorCachePolicy = new CachePolicy(this, "BehaviorManagementCachePolicy", {
            cachePolicyName: `${config.get('environmentname')}BehaviorCachePolicy`,
            defaultTtl: Duration.seconds(1),  //Required in order to allow authorization header pass through
            minTtl: Duration.seconds(1),
            maxTtl: Duration.seconds(1),
            headerBehavior: CacheHeaderBehavior.allowList('Authorization')
        });
        behaviorCachePolicy.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        var originCachePolicy = new OriginRequestPolicy(this, "OriginReqestCachePolicy", {
            queryStringBehavior: OriginRequestQueryStringBehavior.all(),
            originRequestPolicyName: `${config.get('environmentname')}OriginRequestPolicy`,
            headerBehavior: CacheHeaderBehavior.allowList('Host')
        });
        originCachePolicy.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        var pricingBehaviorCachePolicy = new CachePolicy(this, "PricingBehaviorManagementCachePolicy", {
            cachePolicyName: `${config.get('environmentname')}PricingBehaviorCachePolicy`,
            defaultTtl: Duration.seconds(300),  //Required in order to allow authorization header pass through
            minTtl: Duration.seconds(600),
            maxTtl: Duration.seconds(1),
            headerBehavior: CacheHeaderBehavior.allowList('Host'),
            queryStringBehavior: OriginRequestQueryStringBehavior.all()
        });
        pricingBehaviorCachePolicy.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        //Define the different origins
        const userManagementApiOrigin = new HttpOrigin(config.get('nelsonmanagementservice.userserviceapigatewayurl'), {
            originId: "UserManagement",
            originPath: config.get('nelsonmanagementservice.userserviceoriginpath')
        });
        const tenantManagementApiOrigin = new HttpOrigin(config.get('nelsonmanagementservice.tenantserviceapigatewayurl'), {
            originId: "TenantManagement",
            originPath: config.get('nelsonmanagementservice.tenantserviceoriginpath')
        });
        const tenantPropertiesOrigin = new S3Origin(Bucket.fromBucketName(this, 'TenantPropertiesBucket', config.get('tenantproperties.bucketname')), {
            originId: 'TenantProperties',
            originPath: config.get('tenantproperties.originpath')
        });
        const buiBucketSource = new S3Origin(props.buiBucket, {
            originId: "BUIBucket"
        });
        const saasAPI = new LoadBalancerV2Origin(props.loadBalancer, {
            originId: 'SaasAPI',
        });
        //Step 1: Create cloudfront distribution
        var domainNames: string[] = [useClientDomain ? config.get('clientwebsite.domain') : config.get('buihostedzonestack.domain')];
        if (useClientDomain && config.get('clientwebsite.usewwwdomain') == true) {
            domainNames.push(`www.${config.get('clientwebsite.domain')}`);
        }
        const buiCFDistribution = new Distribution(this, 'BuiCFDistribution', {
            comment: useClientDomain ? config.get('clientwebsite.domain') : config.get('buihostedzonestack.domain'),
            defaultBehavior: {
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
                cachePolicy: CachePolicy.CACHING_OPTIMIZED,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                origin: useClientDomain ? new S3Origin(props.clientWebsiteBucket!, {
                    originId: 'ClientWebsite'
                }) : buiBucketSource,
            },
            additionalBehaviors: {
                "/api/user/*": {
                    origin: userManagementApiOrigin,
                    compress: false,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: behaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                },
                "/api/tenant/*": {
                    origin: tenantManagementApiOrigin,
                    compress: false,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: behaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                },
                '/api/prices/*/*': {
                    origin: saasAPI,
                    compress: false,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
                    cachePolicy: pricingBehaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                },
                '/api/m_app/prices/*/*': {
                    origin: saasAPI,
                    compress: false,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
                    cachePolicy: pricingBehaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                },
                '/api/*': {
                    origin: saasAPI,
                    compress: false,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    cachePolicy: CachePolicy.CACHING_DISABLED
                },
                '/*.json': {
                    origin: tenantPropertiesOrigin,
                    compress: false,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: behaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                },
                '/config.txt': {
                    origin: tenantPropertiesOrigin,
                    compress: false,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: behaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                },
                '/management*': {
                    origin: buiBucketSource,
                    compress: false,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: behaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                },
                '/lock*': {
                    origin: buiBucketSource,
                    compress: false,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: behaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                },
                '/??/booking': {
                    origin: buiBucketSource,
                    compress: false,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: behaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                },
                '/??/booking/*': {
                    origin: buiBucketSource,
                    compress: false,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: behaviorCachePolicy,
                    originRequestPolicy: originCachePolicy,
                }
            },
            domainNames: domainNames,
            certificate: certificate
        });
        buiCFDistribution.applyRemovalPolicy(config.get('defaultremovalpolicy'));


        var aRecordName = useClientDomain ? (String(config.get('clientwebsite.domain')).split(`.${config.get('clientwebsite.hostedzone')}`)[0]) : (String(config.get('buihostedzonestack.domain')).split(`.${config.get('buihostedzonestack.hostedzone')}`)[0]);
        //Route domain/sub-domain to cloudfront distribution - Add ARecord in hosted zone
        var aRecord = new ARecord(this, 'NelsonBuiCloudFrontARecord', {
            zone: props.hostedZone,
            recordName: aRecordName,
            comment: useClientDomain ? props.clientWebsiteBucket!.bucketName : props.buiBucket.bucketName,
            ttl: Duration.minutes(5),
            target: RecordTarget.fromAlias(new CloudFrontTarget(buiCFDistribution))
        });
        aRecord.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        cdk.Aspects.of(aRecord).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(aRecord).add(
            new cdk.Tag('nelson:role', `${config.get('tags.nelsonroleprefix')}`)
        );
        cdk.Aspects.of(aRecord).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        //Tag the cloudfront distribution
        cdk.Aspects.of(buiCFDistribution).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(buiCFDistribution).add(
            new cdk.Tag('nelson:role', `${config.get('tags.nelsonroleprefix')}-cloudfront-dist`)
        );
        cdk.Aspects.of(buiCFDistribution).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        if (config.get('clientwebsite.usewwwdomain') == true) {
            var wwwRecord = new CnameRecord(this, "BuiWWWDomain", {
                domainName: config.get('clientwebsite.domain'),
                zone: props.hostedZone,
                recordName: `www.${config.get('clientwebsite.domain')}`,
                comment: `www.${config.get('clientwebsite.domain')}`,
                ttl: Duration.seconds(1800),
            });
            wwwRecord.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            cdk.Aspects.of(wwwRecord).add(
                new cdk.Tag('nelson:client', `saas`)
            );
            cdk.Aspects.of(wwwRecord).add(
                new cdk.Tag('nelson:role', `${config.get('tags.nelsonroleprefix')}`)
            );
            cdk.Aspects.of(wwwRecord).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
        }

        // Create SES configuration
        if (!config.get('buihostedzonestack.useexistingsesidentity')) {
            const sesIdentity = new ses.EmailIdentity(this, 'SESIdentity', {
                identity: ses.Identity.domain(config.get('buihostedzonestack.sesidentityemailaddress')),
                dkimIdentity: ses.DkimIdentity.easyDkim(ses.EasyDkimSigningKeyLength.RSA_2048_BIT),
                dkimSigning: true,
                feedbackForwarding: true
            });
            sesIdentity.applyRemovalPolicy(config.get('defaultremovalpolicy'));

            cdk.Aspects.of(sesIdentity).add(
                new cdk.Tag('nelson:client', `saas`)
            );
            cdk.Aspects.of(sesIdentity).add(
                new cdk.Tag('nelson:role', `${config.get('tags.nelsonroleprefix')}-SES`)
            );
            cdk.Aspects.of(sesIdentity).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );

            const cnameRecord1 = new CfnRecordSet(this, 'SesCNAMERecord1', {
                hostedZoneName: `${props.hostedZone.zoneName}.`,
                name: sesIdentity.dkimDnsTokenName1,
                type: "CNAME",
                resourceRecords: [sesIdentity.dkimDnsTokenValue1],
                ttl: "1800"
            });
            cnameRecord1.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            cdk.Aspects.of(cnameRecord1).add(
                new cdk.Tag('nelson:client', `saas`)
            );
            cdk.Aspects.of(cnameRecord1).add(
                new cdk.Tag('nelson:role', 'route53-hosted-zone')
            );
            cdk.Aspects.of(cnameRecord1).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );

            const cnameRecord2 = new CfnRecordSet(this, 'SesCNAMERecord2', {
                hostedZoneName: `${props.hostedZone.zoneName}.`,
                name: sesIdentity.dkimDnsTokenName2,
                type: "CNAME",
                resourceRecords: [sesIdentity.dkimDnsTokenValue2],
                ttl: "1800"
            });
            cnameRecord2.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            cdk.Aspects.of(cnameRecord2).add(
                new cdk.Tag('nelson:client', `saas`)
            );
            cdk.Aspects.of(cnameRecord2).add(
                new cdk.Tag('nelson:role', 'route53-hosted-zone')
            );
            cdk.Aspects.of(cnameRecord2).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );

            const cnameRecord3 = new CfnRecordSet(this, 'SesCNAMERecord3', {
                hostedZoneName: `${props.hostedZone.zoneName}.`,
                name: sesIdentity.dkimDnsTokenName3,
                type: "CNAME",
                resourceRecords: [sesIdentity.dkimDnsTokenValue3],
                ttl: "1800"
            });
            cnameRecord3.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            cdk.Aspects.of(cnameRecord3).add(
                new cdk.Tag('nelson:client', `saas`)
            );
            cdk.Aspects.of(cnameRecord3).add(
                new cdk.Tag('nelson:role', 'route53-hosted-zone')
            );
            cdk.Aspects.of(cnameRecord3).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
        }
    }
}