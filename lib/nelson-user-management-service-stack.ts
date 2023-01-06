/*
    This stack defines the user management lambda application.
    Architecture and data model reference: https://projectnelson.atlassian.net/wiki/spaces/NELS/pages/2211217409/User+Management

    Resource Dependencies:
    - User Management Service (Code for lambda functions) - https://github.com/ABRGI/nelson-user-management-service
*/

import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { EndpointType } from 'aws-cdk-lib/aws-apigateway';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface UserManagementProps extends cdk.StackProps {
    loginUrl: string,
    userPoolName: string,
    userPoolId: string,
    clientId: string,
    clientSecret: Secret
}

export class NelsonUserManagementServiceStack extends cdk.Stack {
    userManagementServiceApiGw: cdk.aws_apigateway.RestApi;
    constructor(scope: Construct, id: string, props: UserManagementProps) {
        super(scope, id, props);
        const nelsonUserPool = cognito.UserPool.fromUserPoolId(this, "NelsonUserPool", props.userPoolName);
        /*Step 1: Create the Dynamo DB tables
            * User
            * Access Roles
        */
        const userTable = new dynamodb.Table(this, 'UserTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: config.get('nelsonusermanagementservicetack.usertable'),
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        const accessRolesTable = new dynamodb.Table(this, 'AccessRolesTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableClass: dynamodb.TableClass.STANDARD,
            tableName: config.get('nelsonusermanagementservicetack.accessrolestable'),
            removalPolicy: config.get('defaultremovalpolicy'),
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 2,        //TODO: Find the correct values for read and write capacities
            writeCapacity: 2
        });

        /*Step 2: Create api functions
            * Login
            * List users
            * Create/update user
            * Create/update roles
            * Get user info
            * Forgot password
            * Create/update rights (Probably called only from a dev machine)
        */
        const loginFn = new lambda.Function(this, 'LoginFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}UserLogin`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function helps to login the user',
            environment: {
                COGNITO_LOGIN_URL: props.loginUrl,
                ENV_REGION: this.region,
                USERPOOL_CLIENT_ID: props.clientId,
                SECRET_NAME: props.clientSecret.secretName,
                USER_TABLE: config.get('nelsonusermanagementservicetack.usertable')
            }
        });
        props.clientSecret.grantRead(loginFn);
        loginFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        const logoutFn = new lambda.Function(this, 'LogoutFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}UserLogout`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function helps to logout the user',
        });
        logoutFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));

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
                ENV_REGION: this.region
            }
        });
        listUsersFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));

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
                ENV_REGION: this.region,
                USERPOOL_ID: props.userPoolId,
                TEMP_PASSWORD: config.get('nelsonusermanagementservicetack.newuserpassword')
            }
        });
        //Policy can't be created using userpool.grant as it doesn't add the correct user pool id. Same with just ading resource as userpool.userpoolarn.
        //Custom built property to make sure the id is built properly
        updateUserFn.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminGetUser', 'cognito-idp:ListUsers', 'cognito-idp:AdminUpdateUserAttributes', 'cognito-idp:AdminDisableUser', 'cognito-idp:AdminEnableUser'],
            resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`]
        }));
        updateUserFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        const confirmUserFn = new lambda.Function(this, 'ConfirmUserFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}ConfirmUser`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to confirm a new user in nelson',
            environment: {
                COGNITO_LOGIN_URL: props.loginUrl,
                ENV_REGION: this.region,
                USERPOOL_CLIENT_ID: props.clientId,
                SECRET_NAME: props.clientSecret.secretName,
                USER_TABLE: config.get('nelsonusermanagementservicetack.usertable')
            }
        });
        props.clientSecret.grantRead(loginFn);
        confirmUserFn.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['cognito-idp:RespondToAuthChallenge'],
            resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`]
        }));
        confirmUserFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        const updateRoleFn = new lambda.Function(this, 'CrudRolesFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return { statusCode: 200 } }'),    //Basic code
            functionName: `${config.get('environmentname')}RolesHandler`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to update a role with rights and access levels',
            environment: {
                ACCESS_ROLES_TABLE: config.get('nelsonusermanagementservicetack.accessrolestable'),
                ENV_REGION: this.region
            }
        });
        updateRoleFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));

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
                ENV_REGION: this.region,
                USERPOOL_ID: props.userPoolId
            }
        });
        getUserInfoFn.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        //Step 3: Grant lambda dynamo permissions
        userTable.grantReadWriteData(updateUserFn);
        userTable.grantReadData(listUsersFn);
        userTable.grantReadData(getUserInfoFn);
        userTable.grantReadWriteData(loginFn);
        userTable.grantReadWriteData(confirmUserFn);
        accessRolesTable.grantReadWriteData(updateRoleFn);
        accessRolesTable.grantReadData(listUsersFn);
        accessRolesTable.grantReadData(updateUserFn);

        this.userManagementServiceApiGw = new apigw.LambdaRestApi(this, 'UserManagementServiceApi', {
            handler: loginFn,
            proxy: false,
            endpointTypes: [EndpointType.REGIONAL],
            retainDeployments: false,
            description: 'Rest API to manage the Nelson User Management Service',
            restApiName: `${config.get('environmentname')}UserManagementServiceAPI`,
            disableExecuteApiEndpoint: false,
            deploy: false
        });
        //Step 4.1: Add API authoriziation layer
        /*Note: Once the authorizer is created, on aws console, edit, reselect the userpool and save.
            Looks like cdk has an issue where the userpool is not properly configured. Authorization fails if this is not done.
            For all the resources using this auth, remove and add again from the console.
            Alternate: Remove method options from the script below and deploy. Then add back and redeploy after updating the auth on console.
        */
        const auth = new apigw.CognitoUserPoolsAuthorizer(this, 'UserManagementServiceAuthorizer', {
            authorizerName: props.userPoolName,
            cognitoUserPools: [nelsonUserPool]
        });
        auth.applyRemovalPolicy(config.get('defaultremovalpolicy'));
        const methodOptions = {
            authorizer: auth,
            authorizationType: apigw.AuthorizationType.COGNITO
        };
        const userManagementApiResource = this.userManagementServiceApiGw.root.addResource('api');
        const userManagementParentResource = userManagementApiResource.addResource('user');
        const userLoginResource = userManagementParentResource.addResource('login');
        userLoginResource.addMethod('POST', new apigw.LambdaIntegration(loginFn));
        const userLogoutResource = userManagementParentResource.addResource('logout');
        userLogoutResource.addMethod('POST', new apigw.LambdaIntegration(logoutFn));
        const confirmUserResource = userManagementParentResource.addResource('confirmuser');
        confirmUserResource.addMethod('POST', new apigw.LambdaIntegration(confirmUserFn));
        const listUsersResource = userManagementParentResource.addResource('listusers');
        listUsersResource.addMethod('GET', new apigw.LambdaIntegration(listUsersFn), methodOptions);
        const usersResource = userManagementParentResource.addResource('user');
        usersResource.addMethod('GET', new apigw.LambdaIntegration(getUserInfoFn), methodOptions);
        usersResource.addMethod('POST', new apigw.LambdaIntegration(updateUserFn), methodOptions);
        const rolesResource = userManagementParentResource.addResource('roles');
        const updateRoleIntegration = new apigw.LambdaIntegration(updateRoleFn)
        rolesResource.addMethod('GET', updateRoleIntegration, methodOptions);
        rolesResource.addMethod('POST', updateRoleIntegration, methodOptions);

        const userManagementServiceDeployment = new apigw.Deployment(this, 'UserManagementServiceDeployment', {
            api: this.userManagementServiceApiGw,
            retainDeployments: true
        });
        new apigw.Stage(this, "UserManagementServiceStage", {
            deployment: userManagementServiceDeployment,
            stageName: config.get('environmentname')
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

        cdk.Aspects.of(loginFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(loginFn).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(loginFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(logoutFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(logoutFn).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(logoutFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(confirmUserFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(confirmUserFn).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(confirmUserFn).add(
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

        cdk.Aspects.of(this.userManagementServiceApiGw).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(this.userManagementServiceApiGw).add(
            new cdk.Tag('nelson:role', `user-management-service`)
        );
        cdk.Aspects.of(this.userManagementServiceApiGw).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
    }
}