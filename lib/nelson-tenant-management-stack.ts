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
import { EndpointType } from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface TenantManagementProps extends cdk.StackProps {
    userPoolName: string,
    userPoolId: string,
}

export class NelsonTenantManagementServiceStack extends cdk.Stack {
    tenantManagementServiceApiGw: cdk.aws_apigateway.RestApi;
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

        const listTenantFn = new lambda.Function(this, 'ListTenantsFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}ListTenantsFunction`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function helps to login the user',
            environment: {
                TENANT_TABLE: config.get('nelsontenantmanagementservicetack.tenanttable'),
                ENV_REGION: this.region,
            }
        });
        listTenantFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        tenantTable.grantReadWriteData(listTenantFn);

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

        //Add API authoriziation layer
        /*Note: Once the authorizer is created, on aws console, edit, reselect the userpool and save.
            Looks like cdk has an issue where the userpool is not properly configured. Authorization fails if this is not done.
            For all the resources using this auth, remove and add again from the console.
            Alternate: Remove method options from the script below and deploy. Then add back and redeploy after updating the auth on console.
        */
        const nelsonUserPool = cognito.UserPool.fromUserPoolId(this, "NelsonUserPool", props.userPoolName);
        const auth = new apigw.CognitoUserPoolsAuthorizer(this, 'TenantManagementServiceAuthorizer', {
            authorizerName: props.userPoolName,
            cognitoUserPools: [nelsonUserPool]
        });
        auth.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        const methodOptions = {
            authorizer: auth,
            authorizationType: apigw.AuthorizationType.COGNITO
        };

        const tenantManagementApiResource = this.tenantManagementServiceApiGw.root.addResource('api');
        const tenantManagementParentResource = tenantManagementApiResource.addResource('tenant');
        const listTenantsResource = tenantManagementParentResource.addResource('listtenants');
        listTenantsResource.addMethod('GET', new apigw.LambdaIntegration(listTenantFn), methodOptions);

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
    }
}