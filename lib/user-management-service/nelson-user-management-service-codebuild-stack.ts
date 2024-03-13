/*
* Code build project for the user management service stack in Nelson
* The code build only provides the base for the code build project. It doesn't define the build spec
* Build spec is expected in the project buildspec.yml file in the root directory
* Git repo for the code build project is added along with the env variables for each of the function names
* It is the responsibility of the service to specify the correct build commands while using the provided env variables
* Work with the service developer to coordinate build variables for the pipelines, etc.
* One build project should be created for each environment/tenant deployed in Nelson
*/

import * as config from 'config';
import * as cdk from 'aws-cdk-lib';
import { BuildEnvironmentVariableType, BuildSpec, ComputeType, LinuxLambdaBuildImage, Project, Source } from 'aws-cdk-lib/aws-codebuild';
import { Construct } from 'constructs';
import { ChangeUserPasswordFunctionName, ConfirmForgotUserPasswordFunctionName, ConfirmUserFunctionName, CrudRolesFunctionName, CrudUserFunctionName, ForgotUserPasswordFunctionName, GetUserInfoFunctionName, ListUsersFunctionName, LoginFunctionName, LogoutFunctionName, ResetUserPasswordFunctionName } from './nelson-user-management-service-stack';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export class NelsonUserManagementServiceCodebuildStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
        super(scope, id, props);

        var buildProject = new Project(this, 'UserManagementServiceBuildProject', {
            description: `Build project for ${config.get('environmentname')} user management service lambda functions`,
            buildSpec: BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                computeType: ComputeType.LAMBDA_1GB,
                buildImage: LinuxLambdaBuildImage.AMAZON_LINUX_2_NODE_18,
                environmentVariables: {
                    "LOGIN_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: LoginFunctionName
                    },
                    "LOGOUT_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: LogoutFunctionName
                    },
                    "LIST_USERS_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: ListUsersFunctionName
                    },
                    "CRUD_USER_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: CrudUserFunctionName
                    },
                    "CONFIRM_USER_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: ConfirmUserFunctionName
                    },
                    "RESET_USER_PASSWORD_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: ResetUserPasswordFunctionName
                    },
                    "CRUD_ROLES_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: CrudRolesFunctionName
                    },
                    "GET_USER_INFO_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: GetUserInfoFunctionName
                    },
                    "CHANGE_USER_PASSWORD_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: ChangeUserPasswordFunctionName
                    },
                    "FORGOT_USER_PASSWORD_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: ForgotUserPasswordFunctionName
                    },
                    "CONFIRM_FORGOT_USER_PASSWORD_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: ConfirmForgotUserPasswordFunctionName
                    }
                }
            },
            projectName: `${config.get('environmentname')}UserManagementService`,
            concurrentBuildLimit: 1, // Only 1 build allowed since we are not versioning this project build. Maybe pull from config?
            source: Source.gitHub({
                owner: config.get('nelsonusermanagementservicetack.gitrepo.owner'), // Assume that the repo has already been connected in AWS code build.
                repo: config.get('nelsonusermanagementservicetack.gitrepo.repo'),
                branchOrRef: config.get('nelsonusermanagementservicetack.gitrepo.branchorref'),
                cloneDepth: 1   // Prevent full history being checked out during build
            })
        });
        buildProject.addToRolePolicy((new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['lambda:UpdateFunctionCode'],
            resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:${LoginFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${LogoutFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${ListUsersFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${CrudUserFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${ConfirmUserFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${ResetUserPasswordFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${CrudRolesFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${GetUserInfoFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${ChangeUserPasswordFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${ForgotUserPasswordFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${ConfirmForgotUserPasswordFunctionName}`,
            ]
        })));
    }
}