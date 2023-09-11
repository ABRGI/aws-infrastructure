/*
    This stack describes the login provider configuration.
    AWS cognito is used as the default login provider.
    This stack will only create one user pool which is meant for nelson users. Guest user pool will be created per client.
    The stack will also add a lambda function which will inject the rights to the jwt token for the user
    This lambda function code is uploaded later through a deployment pipeline using AWS CLI

    Resource Dependencies:
    - User Management Service (Code for lambda functions) - <insert git link>
    - Requires a verified SES identity in AWS before configuring the cognito email sender for verification, etc.
*/

import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { AccountRecovery, ClientAttributes, OAuthScope, UserPool, UserPoolEmail, UserPoolOperation } from 'aws-cdk-lib/aws-cognito';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';

export class NelsonLoginProviderStack extends cdk.Stack {
    userPoolDomain: cdk.aws_cognito.UserPoolDomain;
    userPoolClient: cdk.aws_cognito.UserPoolClient;
    userPoolClientSecret: cdk.aws_secretsmanager.Secret;
    nelsonUserPool: cdk.aws_cognito.UserPool;
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        //Step 1: Create the user pool
        this.nelsonUserPool = new UserPool(this, 'NelsonUserPool', {
            accountRecovery: AccountRecovery.EMAIL_ONLY,
            email: UserPoolEmail.withSES({
                fromEmail: `noreply@${config.get('nelsonloginproviderstack.loginprovideremaildomain')}`,
                fromName: config.get('applicationname'),
                sesVerifiedDomain: config.get('nelsonloginproviderstack.loginprovideremaildomain')
            }),
            enableSmsRole: false,
            removalPolicy: config.get('defaultremovalpolicy'),
            selfSignUpEnabled: false,
            signInAliases: {
                username: false,
                email: true,
                phone: false
            },
            signInCaseSensitive: false,
            userPoolName: config.get('nelsonloginproviderstack.nelsonuserpool')
        });

        //Step 1.1: Add the domain for the user pool
        this.userPoolDomain = this.nelsonUserPool.addDomain(`userpooldomain`, {
            cognitoDomain: {
                domainPrefix: `${config.get('nelsonloginproviderstack.cognitodomainprefix')}`
            }
        });
        this.userPoolDomain.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        //Step 1.2: Add the client for the user pool
        this.userPoolClient = this.nelsonUserPool.addClient(`${config.get('nelsonloginproviderstack.appname')}`, {
            userPoolClientName: `${config.get('nelsonloginproviderstack.appname')}`,
            generateSecret: config.get('nelsonloginproviderstack.generatesecret'),
            authFlows: {
                userPassword: true
            },
            oAuth: {
                flows: {
                    implicitCodeGrant: true
                },
                callbackUrls: config.get('nelsonloginproviderstack.logincallbackurls'),
                scopes: [
                    OAuthScope.COGNITO_ADMIN,
                    OAuthScope.EMAIL
                ]
            },
            readAttributes: new ClientAttributes().withStandardAttributes({
                email: true,
                emailVerified: true,
                givenName: true,
                locale: true,
                nickname: true,
                fullname: true
            }),
            writeAttributes: new ClientAttributes().withStandardAttributes({
                email: true,
                givenName: true,
                locale: true,
                nickname: true,
                fullname: true
            })
        });
        this.userPoolClient.applyRemovalPolicy(config.get('defaultremovalpolicy'));

        //Step 1.2.1: Add the client secret to secrets manager

        this.userPoolClientSecret = new Secret(this, 'UserPoolClientSecret', {
            description: `Secret for ${config.get('environmentname')} env userpool ${config.get('nelsonloginproviderstack.appname')} client secret`,
            secretName: `${config.get('environmentname')}_${config.get('nelsonloginproviderstack.nelsonuserpool')}_${config.get('nelsonloginproviderstack.appname')}_secret`,
            secretStringValue: config.get('nelsonloginproviderstack.generatesecret') ? this.userPoolClient.userPoolClientSecret : undefined
        })
        this.userPoolClientSecret.applyRemovalPolicy(config.get('defaultremovalpolicy'));


        //Step 2: Create lambda trigger for post auth
        const preTokenGeneratorFn = new lambda.Function(this, 'PreTokenGenerator', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return event }'),    //Basic code
            functionName: `${config.get('environmentname')}NelsonAuthPreTokenGenerator`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to inject user roles, rights and tenant info to the jwt token',
            environment: {
                USER_TABLE: config.get('nelsonusermanagementservicetack.usertable'),
            }
        });

        //Step 3: Add trigger to userpool
        this.nelsonUserPool.addTrigger(UserPoolOperation.PRE_TOKEN_GENERATION, preTokenGeneratorFn);

        //Step 4: Add permissions to the pretokengenerator function to access the correct Dynamo DB tables
        const userTable = dynamodb.Table.fromTableName(this, 'usertable', config.get('nelsonusermanagementservicetack.usertable'));
        const accessRolesTable = dynamodb.Table.fromTableName(this, 'accessrolestable', config.get('nelsonusermanagementservicetack.accessrolestable'));

        userTable.grantReadData(preTokenGeneratorFn);
        accessRolesTable.grantReadData(preTokenGeneratorFn);

        //Step 6: Add tags to resources
        cdk.Aspects.of(this.nelsonUserPool).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(this.nelsonUserPool).add(
            new cdk.Tag('nelson:role', `login-provider`)
        );
        cdk.Aspects.of(this.nelsonUserPool).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(preTokenGeneratorFn).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(preTokenGeneratorFn).add(
            new cdk.Tag('nelson:role', `login-provider`)
        );
        cdk.Aspects.of(preTokenGeneratorFn).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );

        cdk.Aspects.of(this.userPoolClientSecret).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(this.userPoolClientSecret).add(
            new cdk.Tag('nelson:role', `login-provider`)
        );
        cdk.Aspects.of(this.userPoolClientSecret).add(
            new cdk.Tag('nelson:environment', config.get('environmentname'))
        );
    }
}
