import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { AllowedMethods, CachePolicy, Distribution, OriginProtocolPolicy, OriginRequestPolicy, OriginSslPolicy, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';

export interface ShortLinksCloudFrontStackProps extends cdk.StackProps {
    hostedZone: IHostedZone,
    domainCertificate: ICertificate
}

export class NelsonShortLinksStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: ShortLinksCloudFrontStackProps) {
        super(scope, id, props);

        const linksTable = new dynamodb.Table(this, 'LinksTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: `${config.get('environmentname')}-${config.get('nelsonshortlinksservicestack.linktable')}`,
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        const tenantLinksTable = new dynamodb.Table(this, 'TenantLinksTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },  // TODO: Convert to tenant + environment hash
            sortKey: { name: 'linkid', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: `${config.get('environmentname')}-${config.get('nelsonshortlinksservicestack.tenantlinkstable')}`,
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        cdk.Aspects.of(linksTable).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(linksTable).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(linksTable).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );

        cdk.Aspects.of(linksTable).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(linksTable).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(linksTable).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );

        const linkManagerFn = new lambda.Function(this, 'ShortLinksManager', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}ShortLinksManager`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function manages the CRUD actions for short links',
            environment: {
                ENV_REGION: this.region,
                LINKS_TABLE: linksTable.tableName,
                TENANT_LINKS_TABLE: tenantLinksTable.tableName,
                ID_LENGTH: config.get("nelsonshortlinksservicestack.linklength"),
                INCLUDE_TIME_STAMP: config.get("nelsonshortlinksservicestack.usetimestamp"),
            }
        });
        linkManagerFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        linksTable.grantReadWriteData(linkManagerFn);
        tenantLinksTable.grantReadWriteData(linkManagerFn);

        const redirectSvcFn = new lambda.Function(this, 'RedirectServiceFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}ShortLinksRedirectService`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function helps redirect shortlink to expected destination and some validations',
            environment: {
                LINKS_TABLE: linksTable.tableName,
                ENV_REGION: this.region
            }
        });
        redirectSvcFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        linksTable.grantReadWriteData(redirectSvcFn);

        cdk.Aspects.of(linkManagerFn).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(linkManagerFn).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(linkManagerFn).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );
        cdk.Aspects.of(redirectSvcFn).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(redirectSvcFn).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(redirectSvcFn).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );

        // Create the S3 bucket to store error pages
        const errorPagesBucket = new s3.Bucket(this, `ShortLinksErrorPagesBucket`, {
            bucketName: config.get('nelsonshortlinksservicestack.errorpagesbucketname'),
            removalPolicy: config.get('defaultremovalpolicy'),
            publicReadAccess: true,
            //Block all public access: off
            blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false })
        });

        // Step 2 Create a policy statement
        const errorPagesPolicyStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
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

        const redirectFunctionUrl = new lambda.FunctionUrl(this, 'RedirectFunctionUrl', {
            function: redirectSvcFn,
            authType: lambda.FunctionUrlAuthType.NONE,
            cors: {
                allowedOrigins: ["*"],
                allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
                allowCredentials: true,
                maxAge: cdk.Duration.minutes(1)
            }
        });
        const splitFunctionUrl = cdk.Fn.select(2, cdk.Fn.split('/', redirectFunctionUrl.url));

        const shortlinksCFDistribution = new Distribution(this, 'ShortLinksCFDistribution', {
            comment: config.get('nelsonshortlinksservicestack.domain'),
            defaultBehavior: {
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
                cachePolicy: CachePolicy.CACHING_DISABLED,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                origin: new S3Origin(errorPagesBucket, {
                    originId: 'ShortLinksErrorPages'
                })
            },
            additionalBehaviors: {
                [`${config.get('nelsonshortlinksservicestack.distributionlinkbehaviorpattern')}`]: {
                    origin: new HttpOrigin(splitFunctionUrl, {
                        originId: "LinkRedirectFunction",
                        protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
                        originSslProtocols: [OriginSslPolicy.TLS_V1_2],
                        customHeaders: { "nelson-host": config.get('nelsonshortlinksservicestack.domain') }   //When implementing for custom domains, create one distribution per domain and include this in the header. Update with the correct domain
                    }),
                    compress: false,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: CachePolicy.CACHING_DISABLED
                },
            },
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