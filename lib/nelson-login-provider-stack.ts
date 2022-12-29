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
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class NelsonLoginProviderStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        //Step 1: Create the user pool
        const nelsonUserPool = new cognito.UserPool(this, 'NelsonUserPool', {
            accountRecovery: cognito.AccountRecovery.NONE,
            deviceTracking: {
                challengeRequiredOnNewDevice: false,
                deviceOnlyRememberedOnUserPrompt: false
            },
            email: cognito.UserPoolEmail.withSES({
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
            userPoolName: config.get('nelsonloginproviderstack.nelsonuserpool'),
        });

        //Step 2: Create lambda trigger for post auth
        const preTokenGeneratorFn = new lambda.Function(this, 'PreTokenGenerator', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => { console.log(event); return event }'),    //Basic code
            functionName: `${config.get('environmentname')}NelsonAuthPreTokenGenerator`,
            timeout: cdk.Duration.seconds(3),
            description: 'This function is used to inject user roles, rights and tenant info to the jwt token'
        });

        //Step 3: Add trigger to userpool
        nelsonUserPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, preTokenGeneratorFn);

        //Step 4: Add permissions to the pretokengenerator function to access the correct Dynamo DB tables
        const userTable = dynamodb.Table.fromTableName(this, 'usertable', config.get('nelsonusermanagementservicetack.usertable'));
        const accessRolesTable = dynamodb.Table.fromTableName(this, 'accessrolestable', config.get('nelsonusermanagementservicetack.accessrolestable'));
        const accessRightsTable = dynamodb.Table.fromTableName(this, 'accessrightstable', config.get('nelsonusermanagementservicetack.accessrightstable'));

        userTable.grantReadData(preTokenGeneratorFn);
        accessRolesTable.grantReadData(preTokenGeneratorFn);
        accessRightsTable.grantReadData(preTokenGeneratorFn);

        //Step 5: Add Cfn outputs as required
        new cdk.CfnOutput(this, 'PreTokenGeneratorOutput', {
            value: preTokenGeneratorFn.functionArn,
            description: 'Pre-token generator function ARN',
            exportName: 'pretokengeneratorfnoutput'
        });

        new cdk.CfnOutput(this, 'NelsonUserPoolOutput', {
            value: nelsonUserPool.userPoolArn,
            description: 'Nelson user pool ARN',
            exportName: 'nelsonuserpooloutput'
        });

        //Step 6: Add tags to resources
        cdk.Aspects.of(nelsonUserPool).add(
            new cdk.Tag('nelson:client', `saas`)
        );
        cdk.Aspects.of(nelsonUserPool).add(
            new cdk.Tag('nelson:role', `login-provider`)
        );
        cdk.Aspects.of(nelsonUserPool).add(
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
    }
}
