/*
    This stack describes the login provider configuration.
    AWS cognito is used as the default login provider.
    This stack will only create one user pool which is meant for nelson users. Guest user pool will be created per client.
    The stack will also add a lambda function which will inject the rights to the jwt token for the user
    Note that guest user pool is already in place for the current environment.

    Resource Dependencies (git branches to be downloaded to ):
    - User Management Service - <insert git link>
*/

import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import path = require('path');

export class NelsonLoginProviderStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        //Step 1: Create the user pool
        const nelsonuserpool =  new cognito.UserPool(this, 'NelsonUserPool', {
            accountRecovery: cognito.AccountRecovery.NONE,
            deviceTracking: {
                challengeRequiredOnNewDevice: false,
                deviceOnlyRememberedOnUserPrompt: false
            },
            email: cognito.UserPoolEmail.withSES({
                fromEmail: `noreply@${config.get('domain')}`,
                fromName: config.get('applicationname'),
                sesVerifiedDomain: config.get('domain')
            }),
            enableSmsRole: false,
            removalPolicy: RemovalPolicy.DESTROY,
            selfSignUpEnabled: false,
            signInAliases: {
                username: false,
                email: true,
                phone: false
            },
            signInCaseSensitive: false,
            userPoolName: config.get('usermanagementservice.nelsonuserpool'),
        });

        //Step 2: Create lambda trigger for post auth
        const pretokengeneratorfn = new lambda.Function(this, 'PreTokenGenerator', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async (event) => event'),
            functionName: 'NelsonAuthPreTokenGenerator'
        });

        //Step 3: Add trigger to userpool
        nelsonuserpool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, pretokengeneratorfn);
    }
}
