import {SST_APP, SST_STAGE, Task} from "../common";
import process from "process";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";
import {dynamoDb} from "../lib/ddb";
import {RunInstancesRequest} from "aws-sdk/clients/ec2";
import {runInstances} from "../lib/ec2";
import {SubmitJobRequest} from "aws-sdk/clients/batch";
import {RunTaskRequest} from "aws-sdk/clients/ecs";
import {runTasks} from "../lib/ecs";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";
import {startExecutionBatch} from "../lib/sf";

const {
    INSTANCE_PROFILE_NAME,
    BUCKET_NAME
} = process.env;

const requestStateMachineArn = process.env.REQUEST_SF_ARN || "";
const current_region = process.env.AWS_REGION || "";
const {
    VPC_SUBNETS,
    SECURITY_GROUP_ID,
    TASK_DEFINITION_FAMILY,
    CONTAINER_NAME,
    CLUSTER_NAME,
    JOB_DEFINITION,
    JOB_QUEUE,
} = process.env;

export async function handler(task: Task) {
    task.region = current_region;

    if (task.compute === "Fargate") {
        task.states = await createEcsTasks(task, current_region);
    } else if (task.compute === "Batch") {
        task.states = await createJobs(task, current_region);
    } else {
        task.states = await createSf(task, current_region);
    }

    await dynamoDb.put({
        TableName: Table.tasks.tableName,
        Item: {
            ...task,
            createdAt: new Date().toISOString(),
        },
    } as AWS.DynamoDB.DocumentClient.PutItemInput).promise();

    return task.states;
}


async function createEc2(task: Task, region: string) {
    const start_time = Math.round(new Date(task.startTime).getTime() / 1000);
    const end_time = Math.round(new Date(task.endTime).getTime() / 1000);

    const shell = String.raw;

    const bootScript = shell`#!/bin/bash

url="${task.url}"
start_time=${start_time}
end_time=${end_time}
nPerClient=${task.nPerClient}
qps=${task.qps || ""}
taskId=${task.taskId}
logfile=/tmp/log.${task.taskId}.txt
BUCKET_NAME=${BUCKET_NAME}
current_time=$(date +%s)

TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -v http://169.254.169.254/latest/meta-data/instance-id)

while (( current_time < start_time )); do
  sleep 0.1
  current_time=$(date +%s)
done

if [[ -z "$qps" || ! $qps =~ ^[0-9]+$ ]]
then
  for (( i=0; i<nPerClient; i++ )); do
    get_utc_time=$(date -u '+%Y-%m-%dT%H:%M:%S.%3NZ')
    curl -o /dev/null -s $url -w "$taskId $INSTANCE_ID $get_utc_time %{http_code} %{time_total}\\n" >> $logfile
  done
else
  while (( current_time <= end_time )); do
  for (( i=0; i<qps; i++ )); do
    get_utc_time=$(date -u '+%Y-%m-%dT%H:%M:%S.%3NZ')
    (curl -o /dev/null -s $url -w "$taskId $INSTANCE_ID $get_utc_time %{http_code} %{time_total}\n" >> $logfile) &
  done
  sleep 1
  current_time=$(date +%s)
  done
fi

aws s3 cp $logfile s3://$BUCKET_NAME/tasks/$(date '+%Y-%m-%d')/$taskId/$INSTANCE_ID.txt

aws ec2 terminate-instances --instance-ids $INSTANCE_ID
`;

    // cat /var/lib/cloud/instance/scripts/part-001
    // cat /tmp/log*
    // sudo cat /var/log/cloud-init-output.log

    const runInstanceParams: RunInstancesRequest = {
        ImageId: 'ami-0b94777c7d8bfe7e3',
        InstanceType: task.instanceType,
        MinCount: 1,
        MaxCount: 1,
        KeyName: task.keyName,
        UserData: Buffer.from(bootScript).toString('base64'),
        IamInstanceProfile: {
            Name: INSTANCE_PROFILE_NAME,
        },
        TagSpecifications: [
            {
                ResourceType: "instance",
                Tags: [
                    {
                        Key: "Name",
                        Value: `${SST_APP}-${SST_STAGE}-${task.name}-${task.qps ? 'qps' : 'n'}`
                    },
                    {
                        Key: "TaskId",
                        Value: task.taskId
                    }
                ]
            },
        ]
    };

    return await runInstances(task, region, runInstanceParams);
}

async function createJobs(task: Task, region: string) {

    let list = {};

    const batch = new AWS.Batch({region});

    const params: SubmitJobRequest = {
        jobName: `${SST_APP}-${SST_STAGE}-${task.name}-${task.qps ? 'qps' : 'n'}-${task.taskId}`,
        jobDefinition: JOB_DEFINITION || "",
        jobQueue: JOB_QUEUE || "",
        arrayProperties: {
            size: task.c,
        },
        containerOverrides: {
            environment: [
                {
                    name: 'TASK',
                    value: JSON.stringify(task)
                },
            ]
        }
    };

    let res = await batch.submitJob(params).promise();

    list[res.jobId] = "WAITING"

    return list;
}

async function createEcsTasks(task: Task, region: string) {

    const item: RunTaskRequest = {
        cluster: CLUSTER_NAME,
        taskDefinition: TASK_DEFINITION_FAMILY || "",
        count: task.c,
        launchType: 'FARGATE',
        networkConfiguration: {
            awsvpcConfiguration: {
                subnets: JSON.parse(VPC_SUBNETS || "[]"),
                securityGroups: [SECURITY_GROUP_ID || ""],
                assignPublicIp: 'ENABLED',
            },
        },
        overrides: {
            containerOverrides: [
                {
                    name: CONTAINER_NAME,
                    environment: [
                        {
                            name: 'TASK',
                            value: JSON.stringify(task),
                        }
                    ]
                }
            ]
        }
    };

    return await runTasks(task, region, item);
}

async function createSf(task: Task, region: string) {

    let sfExe: StartExecutionInput[] = [];

    for (let i = 0; i < task.c; i++) {
        const client = i + 1;
        sfExe.push({
            name: `${task.qps ? 'qps' : 'n'}_${task.name}_${task.taskId}_${client}`,
            stateMachineArn: requestStateMachineArn.replace(current_region, region),
            input: JSON.stringify({
                Payload: {
                    ...task,
                    client,
                    shouldEnd: false,
                },
            }),
        });
    }

    return await startExecutionBatch(region, sfExe);
}
