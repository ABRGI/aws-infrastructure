/*
    This stack defines the multi-tenant management lambda application.
    Architecture and data model reference: TODO

    Resource Dependencies:
    - Tenant Management Service (Code for lambda functions) - <insert git link>
*/

import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { EndpointType, LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { HttpMethod } from 'aws-cdk-lib/aws-lambda';

export const listTenantFunctionName = `${config.get('environmentname')}ListTenantsFunction`;
export const manageTenantPropertiesFunctionName = `${config.get('environmentname')}ManageTenantProperties`;

export interface TenantManagementProps extends cdk.StackProps {
    userPool: UserPool,
    userPoolName: string
}

export class NelsonTenantManagementServiceStack extends cdk.Stack {
    tenantManagementServiceApiGw: cdk.aws_apigateway.RestApi;
    tenantPropertyBucket: cdk.aws_s3.Bucket;
    constructor(scope: Construct, id: string, props: TenantManagementProps) {
        super(scope, id, props);
        //Create the tenant table
        const tenantTable = new dynamodb.Table(this, 'TenantTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: config.get('nelsontenantmanagementservicetack.tenanttable'),
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        //Create the tenant bucket only if it is required. This will mostly be true only for production.
        if (config.get('nelsontenantmanagementservicetack.createbucket')) {
            //When a new tenant is created, add a cloud front distribution with path as /{client or env name}
            this.tenantPropertyBucket = new Bucket(this, `TenantPropsBucket`, {
                bucketName: config.get('nelsontenantmanagementservicetack.bucketname'),
                removalPolicy: config.get('defaultremovalpolicy'),
                publicReadAccess: config.get('nelsontenantmanagementservicetack.publicreadaccess'),
                //Block all public access: off
                blockPublicAccess: new BlockPublicAccess({ blockPublicAcls: false, blockPublicPolicy: false, ignorePublicAcls: false, restrictPublicBuckets: false })
            });
            this.tenantPropertyBucket.grantPublicAccess();
        }

        const listTenantFn = new lambda.Function(this, 'ListTenantsFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: listTenantFunctionName,
            timeout: cdk.Duration.seconds(3),
            description: 'This function lists the tenants for nelson based on search criteria',
            environment: {
                TENANT_TABLE: config.get('nelsontenantmanagementservicetack.tenanttable'),
                ENV_REGION: this.region,
            }
        });
        listTenantFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        tenantTable.grantReadWriteData(listTenantFn);

        const manageTenantPropertiesFn = new lambda.Function(this, 'ManageTenantPropertiesFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: manageTenantPropertiesFunctionName,
            timeout: cdk.Duration.seconds(3),
            description: 'This function gets or updates the tenant properties based on HTTP method. Required params tenant name, tenant environment',
            environment: {
                TENANT_PROPS_BUCKET: config.get('nelsontenantmanagementservicetack.bucketname'),
                ENV_REGION: this.region,
            }
        });
        manageTenantPropertiesFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        if (config.get('nelsontenantmanagementservicetack.createbucket')) {
            this.tenantPropertyBucket.grantReadWrite(manageTenantPropertiesFn);
        }

        this.tenantManagementServiceApiGw = new apigw.LambdaRestApi(this, 'TenantManagementServiceApi', {
            handler: listTenantFn,
            proxy: false,
            endpointTypes: [EndpointType.REGIONAL],
            retainDeployments: false,
            description: 'Rest API to manage the Nelson Tenant Management Service',
            restApiName: `${config.get('environmentname')}TenantManagementServiceAPI`,
            disableExecuteApiEndpoint: false,
            deploy: false
        });
        this.tenantManagementServiceApiGw.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        const auth = new apigw.CognitoUserPoolsAuthorizer(this, 'TenantManagementServiceAuthorizer', {
            authorizerName: props.userPoolName,
            cognitoUserPools: [props.userPool]
        });
        auth.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        const methodOptions = {
            authorizer: auth,
            authorizationType: apigw.AuthorizationType.COGNITO
        };

        const manageTenantLambdaIntegration = new LambdaIntegration(manageTenantPropertiesFn);

        const tenantManagementApiResource = this.tenantManagementServiceApiGw.root.addResource('api');
        const tenantManagementParentResource = tenantManagementApiResource.addResource('tenant');
        const listTenantsResource = tenantManagementParentResource.addResource('listtenants');
        listTenantsResource.addMethod(HttpMethod.GET, new apigw.LambdaIntegration(listTenantFn));
        const manageEnvironmentResource = tenantManagementParentResource.addResource('{tenantname}').addResource('{environmentname}');
        manageEnvironmentResource.addMethod(HttpMethod.GET, manageTenantLambdaIntegration, methodOptions);
        manageEnvironmentResource.addMethod(HttpMethod.POST, manageTenantLambdaIntegration, methodOptions);

        const tenantManagementServiceDeployment = new apigw.Deployment(this, 'TenantManagementServiceDeployment', {
            api: this.tenantManagementServiceApiGw,
            retainDeployments: true
        });
        new apigw.Stage(this, "TenantManagementServiceStage", {
            deployment: tenantManagementServiceDeployment,
            stageName: config.get('environmentname')
        });

        //Tag resources
        cdk.Aspects.of(tenantTable).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(tenantTable).add(
            new cdk.Tag('nelson:role', `tenant-management-service`)
        );
        cdk.Aspects.of(tenantTable).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(listTenantFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(listTenantFn).add(
            new cdk.Tag('nelson:role', `tenant-management-service`)
        );
        cdk.Aspects.of(listTenantFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        cdk.Aspects.of(this.tenantManagementServiceApiGw).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(this.tenantManagementServiceApiGw).add(
            new cdk.Tag('nelson:role', `tenant-management-service`)
        );
        cdk.Aspects.of(this.tenantManagementServiceApiGw).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        if (config.get('nelsontenantmanagementservicetack.createbucket')) {
            cdk.Aspects.of(this.tenantPropertyBucket).add(
                new cdk.Tag('nelson:client', `saas`)
            );
            cdk.Aspects.of(this.tenantPropertyBucket).add(
                new cdk.Tag('nelson:role', 'tenant-management-service')
            );
            cdk.Aspects.of(this.tenantPropertyBucket).add(
                new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
            );
        }
        cdk.Aspects.of(manageTenantPropertiesFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(manageTenantPropertiesFn).add(
            new cdk.Tag('nelson:role', 'tenant-management-service')
        );
        cdk.Aspects.of(manageTenantPropertiesFn).add(
            new cdk.Tag('nelson:environment', config.get('tags.nelsonenvironment'))
        );
    }
}