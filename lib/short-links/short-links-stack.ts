import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { IAlias, IFunction, Function, Runtime, Architecture, Code, Alias } from 'aws-cdk-lib/aws-lambda';

export const LinkManagerFunctionName = `${config.get('environmentname')}ShortLinksManager`;
export const RedirectServiceFunctionName = `${config.get('environmentname')}ShortLinksRedirectService`;

export class NelsonShortLinksStack extends cdk.Stack {

    redirectSvcFunction: IFunction;

    constructor(scope: Construct, id: string, props: cdk.StackProps) {
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

        const linkManagerFn = new Function(this, 'ShortLinksManager', {
            runtime: Runtime.NODEJS_18_X,
            architecture: Architecture.ARM_64,
            handler: 'index.handler',
            code: Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: LinkManagerFunctionName,
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

        this.redirectSvcFunction = new Function(this, 'RedirectServiceFunction', {
            runtime: Runtime.NODEJS_18_X,
            architecture: Architecture.ARM_64,
            handler: 'index.handler',
            code: Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: RedirectServiceFunctionName,
            timeout: cdk.Duration.seconds(3),
            description: 'This function helps redirect shortlink to expected destination and some validations',
            environment: {
                LINKS_TABLE: linksTable.tableName,
                ENV_REGION: this.region
            }
        });
        this.redirectSvcFunction.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        linksTable.grantReadWriteData(this.redirectSvcFunction);

        // Add this as output to the stack so another deployment tool can pick this up
        // Example of use - SAAS needs this ARN to call the function
        new cdk.CfnOutput(this, 'ShortLinksManagerFunctionArn', {
            value: linkManagerFn.functionArn,
        });

        cdk.Aspects.of(linkManagerFn).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(linkManagerFn).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(linkManagerFn).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );
        cdk.Aspects.of(this.redirectSvcFunction).add(
            new cdk.Tag('nelson:client', config.get('environmentname'))
        );
        cdk.Aspects.of(this.redirectSvcFunction).add(
            new cdk.Tag('nelson:role', 'service')
        );
        cdk.Aspects.of(this.redirectSvcFunction).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );
    }
}