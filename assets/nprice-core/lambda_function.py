import boto3
import json
import os

# Enter the region your instances are in. Include only the region without specifying Availability Zone; e.g.; 'us-east-1'
region = os.getenv('REGION')

# Enter your instances here: ex. ['X-XXXXXXXX', 'X-XXXXXXXX']
instances = [ os.getenv('NPRICE_CORE_INSTANCE_ID') ]

# Enter the ARN for your SNS messages.
sns_arn = os.getenv('SNS_ARN')

def lambda_handler(event, context):
    ec2 = boto3.client('ec2', region_name=region)
    sns = boto3.client('sns', region_name=region)
    
    response = ec2.describe_instances()
   
    for resp in response['Reservations']:
        for inst in resp['Instances']:
            
            # Check that the instance ID is listed above.
            if inst['InstanceId'] in instances:
                
                # If the instance is already running we will send an SNS notification to the ARN specified above.
                if inst['State']['Name'] == "running":
                    print("Instance is already running, sending notification.")
                    sns.publish(TopicArn=sns_arn, Message='The nPrice core EC2 Instance is already running and was for some reason not shut down by the scripts, you might want to check it out.')
         
                # If instance is stopped, we will start it up
                elif inst['State']['Name'] == "stopped":
                    print('OK! Instance is stopped and will be started.')
                    ec2.start_instances(InstanceIds=instances)
                
                # If instance is neither in the started or stopped state, we will send a notification.    
                else:
                    print("Instance is not in a running or stopped state, sending notification")
                    sns.publish(TopicArn=sns_arn, Message='nPrice Core Instance is in an unspecified state (not started or stopped), check it out.')
