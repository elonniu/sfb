import {SST_APP, SST_STAGE, Task} from "../common";
import process from "process";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";
import {dynamoDb} from "../lib/ddb";
import {SubmitJobRequest} from "aws-sdk/clients/batch";
import {RunTaskRequest} from "aws-sdk/clients/ecs";
import {runTasks} from "../lib/ecs";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";
import {startExecutionBatch} from "../lib/sf";

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
    CLUSTER_ARN,
    KDS_NAME
} = process.env;

export async function handler(task: Task) {
    task.region = current_region;
    task.kds = KDS_NAME || "";

    if (task.compute === "Fargate") {
        task.cluster = CLUSTER_ARN;
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

    return task;
}

async function createJobs(task: Task, region: string) {

    let list = {};

    const batch = new AWS.Batch({region});

    const params: SubmitJobRequest = {
        jobName: `${SST_APP}-${SST_STAGE}-${task.name}-${task.taskId}`,
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
            name: `${task.taskId}_${client}`,
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
