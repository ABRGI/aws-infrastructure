/*
    Cloud front stack that defines the short links redirect service hosting configuration
    Use this as a base to create any further client specific distributions
    Note the header 'nelson-host' and don't forget to add to the distribution
*/

import * as cdk from 'aws-cdk-lib';
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { AllowedMethods, CachePolicy, Distribution, OriginProtocolPolicy, OriginRequestPolicy, OriginSslPolicy, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { FunctionUrl, FunctionUrlAuthType, HttpMethod, IFunction } from 'aws-cdk-lib/aws-lambda';
import { ARecord, IHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import * as config from 'config';
import { Construct } from "constructs";

export const ShortLinksErrorBucketName: string = config.get('nelsonshortlinksservicestack.errorpagesbucketname');

export interface ShortLinksCloudFrontStackProps extends cdk.StackProps {
    hostedZone: IHostedZone,
    domainCertificate: ICertificate,
    redirectSvcFunction: IFunction
}

export class NelsonShortLinksCloudFrontStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: ShortLinksCloudFrontStackProps) {
        super(scope, id, props);

        // Create the S3 bucket to store error pages
        const errorPagesBucket = new Bucket(this, `ShortLinksErrorPagesBucket`, {
            bucketName: ShortLinksErrorBucketName,
            removalPolicy: config.get('defaultremovalpolicy'),
            publicReadAccess: true,
            //Block all public access: off
            blockPublicAccess: new BlockPublicAccess({ blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false })
        });

        // Step 2 Create a policy statement
        const errorPagesPolicyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                's3:GetObject'
            ],
            resources: [`${errorPagesBucket.bucketArn}/*`],
        });

        // Step 3 Add the policy statement for the bucket
        errorPagesBucket.addToResourcePolicy(errorPagesPolicyStatement);

        //Step 4 Re-tagging for S3 bucket
        cdk.Aspects.of(errorPagesBucket).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(errorPagesBucket).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(errorPagesBucket).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );

        // Next steps: Add CF distribution setup code. Next add outputs to allow other distributions to add short link service as origin.

        const redirectFunctionUrl = new FunctionUrl(this, 'RedirectFunctionUrl', {
            function: props.redirectSvcFunction,
            authType: FunctionUrlAuthType.NONE,
            cors: {
                allowedOrigins: ["*"],
                allowedMethods: [HttpMethod.GET, HttpMethod.POST],
                allowCredentials: true,
                maxAge: cdk.Duration.minutes(1)
            }
        });
        const splitFunctionUrl = cdk.Fn.select(2, cdk.Fn.split('/', redirectFunctionUrl.url));

        const shortlinksCFDistribution = new Distribution(this, 'ShortLinksCFDistribution', {
            comment: config.get('nelsonshortlinksservicestack.domain'),
            defaultBehavior: {
                origin: new HttpOrigin(splitFunctionUrl, {
                    originId: "LinkRedirectFunction",
                    protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
                    originSslProtocols: [OriginSslPolicy.TLS_V1_2],
                    customHeaders: { "nelson-host": config.get('nelsonshortlinksservicestack.domain') }   //When implementing for custom domains, create one distribution per domain and include this in the header. Update with the correct domain
                }),
                compress: false,
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: CachePolicy.CACHING_DISABLED,
                originRequestPolicy: OriginRequestPolicy.USER_AGENT_REFERER_HEADERS
            },
            additionalBehaviors: {
                '/error???.html': {
                    allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
                    cachePolicy: CachePolicy.CACHING_DISABLED,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    origin: new S3Origin(errorPagesBucket, {
                        originId: 'ShortLinksErrorPages'
                    })
                },
            },
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 404,
                    responsePagePath: '/error404.html'
                },
                {
                    httpStatus: 403,
                    responseHttpStatus: 403,
                    responsePagePath: '/error403.html'
                }
            ],
            domainNames: [config.get('nelsonshortlinksservicestack.domain')],
            certificate: props.domainCertificate
        });
        shortlinksCFDistribution.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        var aRecordName = (String(config.get('nelsonshortlinksservicestack.domain')).split(`.${config.get('nelsonshortlinksservicestack.hostedzone')}`)[0]);
        //Route domain/sub-domain to cloudfront distribution - Add ARecord in hosted zone
        new ARecord(this, 'NelsonShortLinksCloudFrontARecord', {
            zone: props.hostedZone,
            recordName: aRecordName,
            comment: config.get('nelsonshortlinksservicestack.domain'),
            ttl: cdk.Duration.minutes(5),
            target: RecordTarget.fromAlias(new CloudFrontTarget(shortlinksCFDistribution))
        }).applyRemovalPolicy(config.get('defaultremovalpolicy'));

        //Tag the cloudfront distribution
        cdk.Aspects.of(shortlinksCFDistribution).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(shortlinksCFDistribution).add(
            new cdk.Tag('nelson:role', `${config.get('tags.nelsonroleprefix')}-cloudfront-dist`)
        );
        cdk.Aspects.of(shortlinksCFDistribution).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
    }
}