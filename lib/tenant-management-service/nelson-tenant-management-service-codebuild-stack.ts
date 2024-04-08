/*
* Code build project for the tenant management service stack in Nelson
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
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { listTenantFunctionName, manageTenantPropertiesFunctionName } from './nelson-tenant-management-stack';

export class NelsonTenantManagementServiceCodebuildStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
        super(scope, id, props);

        var buildProject = new Project(this, 'TenantManagementServiceBuildProject', {
            description: `Build project for ${config.get('environmentname')} tenant management service lambda functions`,
            buildSpec: BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                computeType: ComputeType.LAMBDA_1GB,
                buildImage: LinuxLambdaBuildImage.AMAZON_LINUX_2_NODE_18,
                environmentVariables: {
                    "LIST_TENANTS_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: listTenantFunctionName
                    },
                    "MANAGE_TENANT_PROPERTIES_FUNCTION_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: manageTenantPropertiesFunctionName
                    },
                }
            },
            projectName: `${config.get('environmentname')}TenantManagementService`,
            concurrentBuildLimit: 1, // Only 1 build allowed since we are not versioning this project build. Maybe pull from config?
            source: Source.gitHub({
                owner: config.get('nelsontenantmanagementservicetack.gitrepo.owner'), // Assume that the repo has already been connected in AWS code build.
                repo: config.get('nelsontenantmanagementservicetack.gitrepo.repo'),
                branchOrRef: config.get('nelsontenantmanagementservicetack.gitrepo.branchorref'),
                cloneDepth: 1   // Prevent full history being checked out during build
            })
        });
        buildProject.addToRolePolicy((new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['lambda:UpdateFunctionCode'],
            resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:${listTenantFunctionName}`,
                `arn:aws:lambda:${this.region}:${this.account}:function:${manageTenantPropertiesFunctionName}`,
            ]
        })));
    }
}