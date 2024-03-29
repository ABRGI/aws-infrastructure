import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { ARecord, CnameRecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontAllowedMethods, CloudFrontWebDistribution, OriginProtocolPolicy, ViewerCertificate, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { Duration } from 'aws-cdk-lib';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';

export interface ClientWebsiteCloudFrontStackProps extends cdk.StackProps {
    hostedZone: IHostedZone,
    viewerAcmCertificateArn: string
}

export class ClientWebsiteStack extends cdk.Stack {
    websiteBucket: cdk.aws_s3.Bucket;
    websiteCfDistribution: CloudFrontWebDistribution;
    constructor(scope: Construct, id: string, props: ClientWebsiteCloudFrontStackProps) {
        super(scope, id, props);
        var certificate = Certificate.fromCertificateArn(this, 'ClientWebsiteDomainCertificate', props.viewerAcmCertificateArn);

        this.websiteBucket = new Bucket(this, 'WebsiteBucket', {
            bucketName: config.get('clientwebsite.bucketname'),
            removalPolicy: config.get('defaultremovalpolicy'),
            publicReadAccess: true,
            blockPublicAccess: new BlockPublicAccess({
                blockPublicAcls: false,
                blockPublicPolicy: false,
                ignorePublicAcls: false,
                restrictPublicBuckets: false
            }),
            websiteIndexDocument: config.get('clientwebsite.indexdocument')
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

        //Use a new distribution only if BUI is not on the same distribution
        if (config.get('buihostedzonestack.useclientdomain') == false) {
            var domainNames: string[] = [config.get('clientwebsite.domain')];
            if (config.get('clientwebsite.usewwwdomain') == true) {
                domainNames.push(`www.${config.get('clientwebsite.domain')}`);
            }
            this.websiteCfDistribution = new CloudFrontWebDistribution(this, 'ClientWebsiteCFDistribution', {
                comment: config.get('clientwebsite.domain'),
                originConfigs: [
                    {
                        connectionTimeout: Duration.seconds(5),
                        customOriginSource: {
                            domainName: config.get('buiinfrastructurestack.bucketname'),
                        },
                        behaviors: [
                            {
                                pathPattern: "/??/*",
                                isDefaultBehavior: false,
                                allowedMethods: CloudFrontAllowedMethods.ALL,
                                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS
                            }
                        ]
                    },
                    //S3 redirect for static website
                    {
                        connectionTimeout: Duration.seconds(5),
                        customOriginSource: {
                            domainName: `${config.get('clientwebsite.bucketname')}.s3-website.${this.region}.amazonaws.com`,
                            originProtocolPolicy: OriginProtocolPolicy.HTTP_ONLY
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
                ],
                viewerCertificate: ViewerCertificate.fromAcmCertificate(certificate, {
                    aliases: domainNames
                })
            });
            this.websiteCfDistribution.applyRemovalPolicy(config.get('defaultremovalpolicy'));

            //Route domain/sub-domain to cloudfront distribution - Add ARecord in hosted zone
            var aRecord = new ARecord(this, 'ClientWebsiteCloudFrontARecord', {
                zone: props.hostedZone,
                recordName: String(config.get('clientwebsite.domain')).split(`.${config.get('clientwebsite.hostedzone')}`)[0],  //Get only the subdomain value
                comment: config.get('clientwebsite.domain'),
                ttl: Duration.minutes(5),
                target: RecordTarget.fromAlias(new CloudFrontTarget(this.websiteCfDistribution))
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
            cdk.Aspects.of(this.websiteCfDistribution).add(
                new cdk.Tag('nelson:client', `saas`)
            );
            cdk.Aspects.of(this.websiteCfDistribution).add(
                new cdk.Tag('nelson:role', `${config.get('tags.nelsonroleprefix')}-cloudfront-dist`)
            );
            cdk.Aspects.of(this.websiteCfDistribution).add(
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
        }
    }
}