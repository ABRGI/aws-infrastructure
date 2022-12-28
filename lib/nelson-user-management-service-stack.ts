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
        const userTable = new dynamodb.Table(this, 'usertable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: config.get('nelsonusermanagementservicetack.usertable'),
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        const accessRolesTable = new dynamodb.Table(this, 'accessrolestable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: config.get('nelsonusermanagementservicetack.accessrolestable'),
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        const accessRightsTable = new dynamodb.Table(this, 'accessrightstable', {
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
        const listUsersFn = new lambda.Function(this, 'ListUsersFunction', {
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

        const updateUserFn = new lambda.Function(this, 'CrudUserFunction', {
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

        const updateRoleFn = new lambda.Function(this, 'CrudRolesFunction', {
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

        const getUserInfoFn = new lambda.Function(this, 'GetUserInfoFunction', {
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

        const forgotUserPasswordFn = new lambda.Function(this, 'ForgotUserPasswordFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}ForgotUserPassword`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to generated the required actions for user to recover password'
        });

        const updateUserRightsFn = new lambda.Function(this, 'CrudRightsFunction', {
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
        userTable.grantReadWriteData(updateUserFn);
        userTable.grantReadData(listUsersFn);
        userTable.grantReadData(getUserInfoFn);
        accessRolesTable.grantReadWriteData(updateRoleFn);
        accessRolesTable.grantReadData(listUsersFn);
        accessRolesTable.grantReadData(updateUserFn);
        accessRightsTable.grantReadWriteData(updateUserRightsFn);
        accessRightsTable.grantReadData(updateRoleFn);
        accessRightsTable.grantReadData(updateUserFn);
        accessRightsTable.grantReadData(listUsersFn);

        //Step 4: Create the API gateway and methods
        const userManagementServiceApiGw = new apigw.RestApi(this, 'UserManagementServiceApi', {
            restApiName: `${config.get('environmentname')}UserManagementServiceAPI`,
            description: 'Rest API to manage the Nelson User Management Service',
            retainDeployments: false,
            deploy: false
        });
        //Step 4.1: Add API authoriziation layer
        const userPool = cognito.UserPool.fromUserPoolId(this, "NelsonUserPool", config.get('nelsonloginproviderstack.nelsonuserpool'));
        const auth = new apigw.CognitoUserPoolsAuthorizer(this, 'UserManagementServiceAuthorizer', {
            cognitoUserPools: [userPool]
        });
        const methodOptions = {
            authorizer: auth,
            authorizationType: apigw.AuthorizationType.COGNITO
        };
        const listusersresource = userManagementServiceApiGw.root.addResource('listusers');
        listusersresource.addMethod('GET', new apigw.LambdaIntegration(listUsersFn), methodOptions);
        const usersresource = userManagementServiceApiGw.root.addResource('user');
        usersresource.addMethod('GET', new apigw.LambdaIntegration(getUserInfoFn), methodOptions);
        usersresource.addMethod('POST', new apigw.LambdaIntegration(updateUserFn), methodOptions);
        const rolesresource = userManagementServiceApiGw.root.addResource('roles');
        const updateroleintegration = new apigw.LambdaIntegration(updateRoleFn)
        rolesresource.addMethod('GET', updateroleintegration, methodOptions);
        rolesresource.addMethod('POST', updateroleintegration, methodOptions);
        const rightresource = userManagementServiceApiGw.root.addResource('rights');
        const updaterightintegration = new apigw.LambdaIntegration(updateRoleFn)
        rightresource.addMethod('GET', updaterightintegration, methodOptions);
        rightresource.addMethod('POST', updaterightintegration, methodOptions);
        const forgotpasswordresource = userManagementServiceApiGw.root.addResource('forgotpassword');
        forgotpasswordresource.addMethod('POST', new apigw.LambdaIntegration(forgotUserPasswordFn), methodOptions);

        const userManagementServiceDeployment = new apigw.Deployment(this, 'UserManagementServiceDeployment', {
            api: userManagementServiceApiGw,
            retainDeployments: false
        });
        new apigw.Stage(this, "UserManagementServiceStage", {
            deployment: userManagementServiceDeployment,
            stageName: config.get('environmentname')
        });

        //Step 5: Define Cfn outputs
        new cdk.CfnOutput(this, 'UserTableOutput', {
            value: userTable.tableArn,
            description: "Arn of the user table",
            exportName: 'usertableoutput'
        });

        new cdk.CfnOutput(this, 'AccessRolesTableOutput', {
            value: accessRolesTable.tableArn,
            description: "Arn of the accessroles table",
            exportName: 'accessrolestableoutput'
        });

        new cdk.CfnOutput(this, 'AccessRightsTableOutput', {
            value: accessRightsTable.tableArn,
            description: "Arn of the accessrights table",
            exportName: 'accessrightstableoutput'
        });

        //Step 6: Tag resources
        cdk.Aspects.of(userTable).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(userTable).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(userTable).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(accessRolesTable).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(accessRolesTable).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(accessRolesTable).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(accessRightsTable).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(accessRightsTable).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(accessRightsTable).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(listUsersFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(listUsersFn).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(listUsersFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(updateUserFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(updateUserFn).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(updateUserFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(updateRoleFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(updateRoleFn).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(updateRoleFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(getUserInfoFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(getUserInfoFn).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(getUserInfoFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(forgotUserPasswordFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(forgotUserPasswordFn).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(forgotUserPasswordFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(updateUserRightsFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(updateUserRightsFn).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(updateUserRightsFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
        
        cdk.Aspects.of(userManagementServiceApiGw).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(userManagementServiceApiGw).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(userManagementServiceApiGw).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
    }
}