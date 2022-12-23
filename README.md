# AWS Infrastructure code for Nelson services

The language to be used for this project is TypeScript.
Project structure
- bin folder contains the final service or application deployment code. This will combine multiple stacks as required
- lib folder contains the individual stacks or constructs
- stacks are designed to be self contained with minimal dependency on external resources. If there is any dependency, the pass it as a parameter in the props of the stack or construct through the app

## Execution
- Set the NODE_ENV variable to the environment that is being deployed
- Create a config file with the NODE_ENV value to override the default values
- Create cloud formation templates and asset files using command `NODE_ENV={environmentname} cdk synth --app "npx ts-node --prefer-ts-exts bin/{filename}.ts" [{stackname1}, {stackname2}]` --profile {profilename}
- Deploy individual apps by running `NODE_ENV={environmentname} cdk deploy --app "npx ts-node --prefer-ts-exts bin/{filename}.ts" [{stackname1}, {stackname2}]` --profile {profilename}
- Note that stack names are optional. If non specified, all stacks are built or deployed
- If app is not specified, then the default app specified in cdk.json is used
- Similar structure should work for cdk diff
- If default profile should be used, ignore the profile attribute
- Example code (to diff): `NODE_ENV=test cdk diff --app  "npx ts-node --prefer-ts-exts bin/user-management-service.ts" --profile nelson`

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
