import {ApiHandler} from "sst/node/api";
import {jsonResponse, nanoid} from "sst-helper";
import AWS from "aws-sdk";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";
import {StatesList, Task} from "../common";
import {HttpStatusCode} from "axios";
import {Table} from "sst/node/table";
import {startExecutionBatch} from "../lib/sf";
import {checkStackDeployment, SST_APP, SST_STAGE} from "../lib/cf";
import process from "process";
import {RunInstancesRequest} from "aws-sdk/clients/ec2";
import {runInstances} from "../lib/ec2";
import {RunTaskRequest} from "aws-sdk/clients/ecs";
import {runTasks} from "../lib/ecs";
import {SubmitJobRequest} from "aws-sdk/clients/batch";

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
    JOB_QUEUE
} = process.env;

export const handler = ApiHandler(async (_evt) => {

    let task: Task = JSON.parse(_evt.body || "{}");

    if (_evt.requestContext.http.sourceIp !== process.env.SOURCE_IP) {
        return jsonResponse({msg: "sourceIp is not allowed"}, 400);
    }

    try {
        task = await checkTasks(task);
        const states = await dispatchTask(task);
        return jsonResponse({
            ...task,
            states,
        });

    } catch (e: any) {
        return jsonResponse({msg: e.message}, 500);
    }

});

async function checkTasks(task: Task) {

    if (task.report) {
        task.report = true;
    }

    if (!task.taskName) {
        throw new Error("taskName is empty");
    }

    if (!["EC2", "Lambda", "Fargate", "Batch"].includes(task.compute)) {
        throw new Error(`compute must be in ${["EC2", "Lambda", "Fargate", "Batch"].join(',')}`);
    }

    if (!["API", "HTML"].includes(task.taskType)) {
        throw new Error(`taskType must be in ${["API", "HTML"].join(',')}`);
    }

    if (task.compute === "EC2") {

        if (!task.KeyName) {
            throw new Error("KeyName must be set when compute is EC2");
        }

        if (!task.InstanceType) {
            task.InstanceType = 't2.micro';
        }

    }

    if (!task.taskType) {
        throw new Error("taskType is empty");
    }

    if (!task.url || !task.timeoutMs) {
        throw new Error("url, timeout is empty");
    }

    try {
        new URL(task.url);
    } catch (e) {
        throw new Error("url is invalid");
    }

    if (!["GET", "POST"].includes(task.method)) {
        throw new Error(`method must be in ${["GET", "POST"].join(',')}`);
    }

    // n and qps can not be both empty
    if (task.n === undefined && task.qps === undefined) {
        throw new Error("n and qps can not be both empty");
    }

    // n and qps can not be both set
    if (task.n !== undefined && task.qps !== undefined) {
        throw new Error("n and qps can not be both set");
    }

    // n must be greater than 0 and be integer
    if (task.n !== undefined && (task.n <= 0 || !Number.isInteger(task.n))) {
        throw new Error("n must be greater than 0 and be integer");
    }

    if (task.c === undefined) {
        task.c = 1;
    }

    // c must be greater than 0 and be integer
    if ((task.c <= 0 || !Number.isInteger(task.c))) {
        throw new Error("c must be greater than 0 and be integer");
    }

    // c must be less than n
    if (task.c !== undefined && task.n !== undefined && task.c > task.n) {
        throw new Error("c must be less than n");
    }

    if (task.n && task.c) {
        task.nPerClient = Math.ceil(task.n / task.c);
    }

    // qps must be greater than 0 and be integer
    if (task.qps !== undefined && (task.qps <= 0 || !Number.isInteger(task.qps))) {
        throw new Error("qps must be greater than 0 and be integer");
    }

    // timeout must be greater than 0 and be integer
    if (task.timeoutMs <= 0 || !Number.isInteger(task.timeoutMs)) {
        throw new Error("timeoutMs must be greater than 0 and be integer");
    }

    if (!Object.values(HttpStatusCode).includes(task.successCode)) {
        throw new Error(`successCode must be in [${Object.values(HttpStatusCode).join(',')}]`);
    }

    // the startTime and endTime must be time string and greater than now
    const now = new Date().getTime();
    if (task.startTime) {
        // startTime must be greater than now - 1 hours
        if (now - 3600 * 1000 > new Date(task.startTime).getTime()) {
            throw new Error("startTime must be greater than now - 1 hours");
        }
        task.startTime = new Date(new Date(task.startTime).getTime()).toISOString();
    } else {
        if (task.taskDelaySeconds) {
            task.startTime = new Date(new Date().getTime() + task.taskDelaySeconds * 1000).toISOString();
        } else {
            task.startTime = new Date().toISOString();
        }
    }

    if (task.endTime) {
        if (now > new Date(task.endTime).getTime()) {
            throw new Error("endTime must be greater than now");
        }
        task.endTime = new Date(new Date(task.endTime).getTime()).toISOString();
    } else {
        task.endTime = new Date(new Date(task.startTime).getTime() + 600 * 1000).toISOString();
    }

    // endTime must be greater than startTime
    if (new Date(task.startTime).getTime() > new Date(task.endTime).getTime()) {
        throw new Error("endTime must be greater than startTime");
    }

    // endTime must be less than startTime + 48 hours
    if (new Date(task.startTime).getTime() + 3600 * 48 * 1000 < new Date(task.endTime).getTime()) {
        throw new Error("endTime must be less than startTime + 48 hours");
    }

    if (task.compute === "Batch" && task.c < 2) {
        throw new Error("Batch compute c must be greater than 1")
    }

    if (!task.regions) {
        task.regions = [current_region];
    } else {
        const deployRegions = await checkStackDeployment(task.regions);
        // list task.regions are not in deployRegions
        const notDeployRegions = task.regions.filter((region) => !deployRegions.includes(region));
        if (notDeployRegions.length > 0) {
            if (deployRegions.length > 0) {
                throw new Error(`ServerlessBench not in [${notDeployRegions.join(', ')}] yet, available regions [${deployRegions.join(', ')}]`);
            } else {
                throw new Error(`ServerlessBench not in [${notDeployRegions.join(', ')}] yet`);
            }
        }
    }

    task.taskId = nanoid();
    task.createdAt = new Date().toISOString();

    return task;
}

async function dispatchTask(task: Task) {

    let statesList: StatesList = {};

    for (const region of task.regions) {

        task.region = region;

        let states;

        if (task.compute === "EC2") {
            states = await createEc2(task, region);
        } else if (task.compute === "Fargate") {
            states = await createEcsTasks(task, region);
        } else if (task.compute === "Batch") {
            states = await createJobs(task, region);
        } else {
            states = await createSf(task, region);
        }

        const dynamodb = new AWS.DynamoDB.DocumentClient({region});
        await dynamodb.put({
            TableName: Table.tasks.tableName,
            Item: {
                ...task,
                states,
                createdAt: new Date().toISOString(),
            },
        } as AWS.DynamoDB.DocumentClient.PutItemInput).promise();

        statesList[region] = states;
    }

    return statesList;
}

async function createSf(task: Task, region: string) {

    let sfExe: StartExecutionInput[] = [];

    for (let i = 0; i < task.c; i++) {
        const taskClient = i + 1;
        sfExe.push({
            name: `${task.qps ? "qps" : "batch"}_${task.taskName}_${task.taskId}_${taskClient}`,
            stateMachineArn: requestStateMachineArn.replace(current_region, region),
            input: JSON.stringify({
                Payload: {
                    ...task,
                    taskClient,
                    shouldEnd: false,
                },
            }),
        });
    }

    return await startExecutionBatch(region, sfExe);
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
        InstanceType: task.InstanceType,
        MinCount: 1,
        MaxCount: 1,
        KeyName: task.KeyName,
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
                        Value: `${SST_APP}-${SST_STAGE}-${task.taskName}-${task.qps ? 'qps' : 'batch'}`
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
        jobName: `${SST_APP}-${SST_STAGE}-${task.taskName}-${task.qps ? 'qps' : 'batch'}-${task.taskId}`,
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

    list[res.jobArn] = {
        jobId: res.jobId,
        jobName: res.jobName,
        status: "WAITING"
    }

    return list;
}
