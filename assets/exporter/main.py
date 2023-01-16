import json
import logging
import os
import re

import boto3

"""
Evaluates whether or not the triggering event notification is for an automated
snapshot of the desired DB_NAME, then initiates an RDS snapshot export to S3
task of that snapshot if so.

The function returns the response from the `start_export_task` API call if
it was successful. The function execution will fail if any errors are produced
when making the API call. Otherwise, if the triggering event does not correspond
to the RDS_EVENT_ID or DB_NAME we are expecting to see, the function will return
nothing.
"""

logger = logging.getLogger()
logger.setLevel(os.getenv("LOG_LEVEL", logging.INFO))


def handler(event, context):

    logger.debug("EVENT INFO:")
    logger.debug(json.dumps(event))
    source_arn = json.loads(event["body"])["Source ARN"]
    s3_bucket_name = json.loads(event["body"])["S3 Bucket Name"]
    regex = r"[a-z][a-z0-9\-]{0,254}$"
    export_task_identifier = re.search(regex, source_arn).group()
    response = boto3.client("rds").start_export_task(
        ExportTaskIdentifier=export_task_identifier,
        SourceArn=source_arn,
        S3BucketName=s3_bucket_name,
        IamRoleArn=os.environ["SNAPSHOT_TASK_ROLE"],
        KmsKeyId=os.environ["SNAPSHOT_TASK_KEY"],
    )
    response["SnapshotTime"] = str(response["SnapshotTime"])

    logger.info("Snapshot export task started")
    logger.info(json.dumps(response))