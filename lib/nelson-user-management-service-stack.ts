/*
    This stack defines the user management lambda application.
    Architecture and data model reference: https://projectnelson.atlassian.net/wiki/spaces/NELS/pages/2211217409/User+Management

    Resource Dependencies:
    - User Management Service (Code for lambda functions) - <insert git link>
*/

import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export class NelsonUserManagementServiceStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        /*Step 1: Create the Dynamo DB tables
            * User
            * Access Roles
            * Access Rights
        */
        const usertable = new dynamodb.Table(this, 'usertable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: config.get('nelsonusermanagementservicetack.usertable'),
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        const accessrolestable = new dynamodb.Table(this, 'accessrolestable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: config.get('nelsonusermanagementservicetack.accessrolestable'),
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        const accessrightstable = new dynamodb.Table(this, 'accessrightstable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: config.get('nelsonusermanagementservicetack.accessrightstable'),
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        /*Step 2: Create api functions
            * List users
            * Create/update user
            * Create/update roles
            * Get user info
            * Forgot password
            * Create/update rights (Probably called only from a dev machine)
        */
        const listusersfn = new lambda.Function(this, 'ListUsersFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}ListUsers`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function lists all users in nelson',
            environment: {
                USER_TABLE: config.get('nelsonusermanagementservicetack.usertable'),
                ACCESS_ROLES_TABLE: config.get('nelsonusermanagementservicetack.accessrolestable'),
                ACCESS_RIGHTS_TABLE: config.get('nelsonusermanagementservicetack.accessrightstable')
            }
        });

        const updateuserfn = new lambda.Function(this, 'CrudUserFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}UpdateUser`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to update a user property in nelson',
            environment: {
                USER_TABLE: config.get('nelsonusermanagementservicetack.usertable'),
                ACCESS_ROLES_TABLE: config.get('nelsonusermanagementservicetack.accessrolestable'),
                ACCESS_RIGHTS_TABLE: config.get('nelsonusermanagementservicetack.accessrightstable')
            }
        });

        const updaterolefn = new lambda.Function(this, 'CrudRolesFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}UpdateRole`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to update a role with rights and access levels',
            environment: {
                ACCESS_ROLES_TABLE: config.get('nelsonusermanagementservicetack.accessrolestable'),
                ACCESS_RIGHTS_TABLE: config.get('nelsonusermanagementservicetack.accessrightstable')
            }
        });

        const getuserinfofn = new lambda.Function(this, 'GetUserInfoFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}GetUserDetail`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to get the details about a user',
            environment: {
                USER_TABLE: config.get('nelsonusermanagementservicetack.usertable'),
                ACCESS_ROLES_TABLE: config.get('nelsonusermanagementservicetack.accessrolestable'),
                ACCESS_RIGHTS_TABLE: config.get('nelsonusermanagementservicetack.accessrightstable')
            }
        });

        const forgotuserpasswordfn = new lambda.Function(this, 'ForgotUserPasswordFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}ForgotUserPassword`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to generated the required actions for user to recover password'
        });

        const updaterightsfun = new lambda.Function(this, 'CrudRightsFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}UpdateRights`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to add new rights to the access rights table for reference',
            environment: {
                ACCESS_RIGHTS_TABLE: config.get('nelsonusermanagementservicetack.accessrightstable')
            }
        });

        //Step 3: Grant lambda dynamo permissions
        usertable.grantReadWriteData(updateuserfn);
        usertable.grantReadData(listusersfn);
        usertable.grantReadData(getuserinfofn);
        accessrolestable.grantReadWriteData(updaterolefn);
        accessrolestable.grantReadData(listusersfn);
        accessrolestable.grantReadData(updateuserfn);
        accessrightstable.grantReadWriteData(updaterightsfun);
        accessrightstable.grantReadData(updaterolefn);
        accessrightstable.grantReadData(updateuserfn);
        accessrightstable.grantReadData(listusersfn);

        //Step 4: Create the API gateway and methods
        const usermanagementserviceapigw = new apigw.RestApi(this, 'UserManagementServiceApi', {
            restApiName: `${config.get('environmentname')}UserManagementServiceAPI`,
            description: 'Rest API to manage the Nelson User Management Service',
            retainDeployments: false,
            deploy: false
        });
        //Step 4.1: Add API authoriziation layer
        const userpool = cognito.UserPool.fromUserPoolId(this, "userpool", config.get('nelsonloginproviderstack.nelsonuserpool'));
        const auth = new apigw.CognitoUserPoolsAuthorizer(this, 'usermanagementserviceauthorizer', {
            cognitoUserPools: [userpool]
        });
        const methodoptions = {
            authorizer: auth,
            authorizationType: apigw.AuthorizationType.COGNITO
        };
        const listusersresource = usermanagementserviceapigw.root.addResource('listusers');
        listusersresource.addMethod('GET', new apigw.LambdaIntegration(listusersfn), methodoptions);
        const usersresource = usermanagementserviceapigw.root.addResource('user');
        usersresource.addMethod('GET', new apigw.LambdaIntegration(getuserinfofn), methodoptions);
        usersresource.addMethod('POST', new apigw.LambdaIntegration(updateuserfn), methodoptions);
        const rolesresource = usermanagementserviceapigw.root.addResource('roles');
        const updateroleintegration = new apigw.LambdaIntegration(updaterolefn)
        rolesresource.addMethod('GET', updateroleintegration, methodoptions);
        rolesresource.addMethod('POST', updateroleintegration, methodoptions);
        const rightresource = usermanagementserviceapigw.root.addResource('rights');
        const updaterightintegration = new apigw.LambdaIntegration(updaterolefn)
        rightresource.addMethod('GET', updaterightintegration, methodoptions);
        rightresource.addMethod('POST', updaterightintegration, methodoptions);
        const forgotpasswordresource = usermanagementserviceapigw.root.addResource('forgotpassword');
        forgotpasswordresource.addMethod('POST', new apigw.LambdaIntegration(forgotuserpasswordfn), methodoptions);

        const usermanagementservicedeployment = new apigw.Deployment(this, 'usermanagementservicedeployment', {
            api: usermanagementserviceapigw,
            retainDeployments: false
        });
        new apigw.Stage(this, "usermanagementservicestage", {
            deployment: usermanagementservicedeployment,
            stageName: config.get('environmentname')
        });

        //Define Cfn outputs
        new cdk.CfnOutput(this, 'usertableoutput', {
            value: usertable.tableArn,
            description: "Arn of the user table",
            exportName: 'usertableoutput'
        });

        new cdk.CfnOutput(this, 'accessrolestableoutput', {
            value: accessrolestable.tableArn,
            description: "Arn of the accessroles table",
            exportName: 'accessrolestableoutput'
        });

        new cdk.CfnOutput(this, 'accessrightstableoutput', {
            value: accessrightstable.tableArn,
            description: "Arn of the accessrights table",
            exportName: 'accessrightstableoutput'
        });
    }
}