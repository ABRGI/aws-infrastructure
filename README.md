# AWS Infrastructure code for Nelson services

The language to be used for this project is TypeScript.

## Project structure

- bin folder contains the final service or application deployment code. This will combine multiple stacks as required
- lib folder contains the individual stacks or constructs
- stacks are designed to be self contained with minimal dependency on external resources. If there is any dependency, then pass it as a parameter in the props of the stack or construct through the app
- config folder contains the default config which **MUST** contain all configs used in the code. Tenant specific coinfig files are also created which will override the default config value based on the NODE_ENV environment variable value at runtime

## Dependencies

Project uses AWS CDK V2. For list of dependencies, refer the [AWS CDK V2 documentation](https://docs.aws.amazon.com/cdk/index.html). Alternatively, refer the [CDK Workshop website](https://cdkworkshop.com/15-prerequisites.html) for simple tutorial

## Execution

- Run npm install when running for the first time to download required node modules
- Set the NODE_ENV variable to the environment that is being deployed
- Create a config file with the NODE_ENV value to override the default values
- Create cloud formation templates and asset files using command `NODE_ENV={environment} appscript={target app script name} stack={target stack} npm run synth -- --profile {aws profile name}`
- To diff the code with what is on CloudFormation, run command `NODE_ENV={environment} appscript={target app script name} stack={target stack} npm run diff -- --profile {aws profile name}`
- Deploy individual apps by running `NODE_ENV={environment} appscript={target app script name} stack={target stack} npm run deploy -- --profile {aws profile name}`
- Note that stack name is optional. If non specified, all stacks are built or deployed as part of the app
- If app is not specified, then the default app specified in cdk.json is used
- Similar structure should work for cdk diff
- If default profile should be used, ignore the profile attribute
- Example code (to diff): `NODE_ENV=test appscript=user-management-service stack=TestLoginProvide npm run diff -- --profile nelson`
- Use stack=-all to deploy all stacks if the app has multiple stacks: `NODE_ENV=test appscript=user-management-service stack=--all npm run deploy -- --profile nelson`
- run `cdk diff` or `cdk synth` or `cdk deploy` to run for default app specified in cdk.json

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
* `NODE_ENV={environment} appscript={target app script name} stack={target stack} npm run {diff|synth|deploy|destroy} -- --profile {aws profile name}`       runs the diff, synth, deploy or destroy commands

## Notes

- Remember to bootstrap the environment using `cdk bootstrap` command. Follow [Bootstraping with CDK](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) for more information
- If running code on Windows, update package.json scripts to use environment variables in format `%variablename%` instead of `$variablename`. Set environment variables using the SET {variable}={value} command
- Remember to check the type of terminal when running the code from VS Code. If windows, modify execution scripts based on powershell or cmd terminal type

- **aws-rds-snapshot-export-pipeline-cdk** by using following commands with `NODE_ENV=development`:
    - `cdk diff RdsSnapshotExportToS3Pipeline --app "npx ts-node --prefer-ts-exts bin/aws-rds-snapshot-export-pipeline-cdk.ts"`
    - `cdk synth RdsSnapshotExportToS3Pipeline --app "npx ts-node --prefer-ts-exts bin/aws-rds-snapshot-export-pipeline-cdk.ts"`
    - `cdk deploy RdsSnapshotExportToS3Pipeline --app "npx ts-node --prefer-ts-exts bin/aws-rds-snapshot-export-pipeline-cdk.ts"`
    - `cdk destroy RdsSnapshotExportToS3Pipeline --app "npx ts-node --prefer-ts-exts bin/aws-rds-snapshot-export-pipeline-cdk.ts"`
