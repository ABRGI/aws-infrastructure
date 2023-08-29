import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class NelsonShortLinksStack extends cdk.Stack {
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
            sortKey: {name: 'linkid', type: dynamodb.AttributeType.STRING},
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: `${config.get('environmentname')}-${config.get('nelsonshortlinksservicestack.tenantlinkstable')}`,
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        const linkManagerFn = new lambda.Function(this, 'ShortLinksManager', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}ShortLinksManager`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function manages the CRUD actions for short links',
            environment: {
                LINKS_TABLE: linksTable.tableName,
                TENANT_LINKS_TABLE: tenantLinksTable.tableName,
                ENV_REGION: this.region
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
            functionName: `${config.get('environmentname')}RedirectService`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function helps redirect shortlink to expected destination and some validations',
            environment: {
                LINKS_TABLE: linksTable.tableName,
                ENV_REGION: this.region
            }
        });
        redirectSvcFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        linksTable.grantReadWriteData(redirectSvcFn);
        // TODO: Add logs for incoming url clicks and changes

        // Next steps: Add CF distribution setup code. Next add outputs to allow other distributions to add short link service as origin.
    }
}