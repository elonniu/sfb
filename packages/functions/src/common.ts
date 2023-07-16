import {HttpStatusCode} from "axios";
import {Arn} from "aws-sdk/clients/stepfunctions";
import {Table} from "sst/node/table";
import AWS from "aws-sdk";
import {batchGet, dynamoDb} from "./lib/ddb";

export interface Execution {
    executionArn: Arn;
    startDate: string;
    status?: string;
    executionUrl?: string;
}

export type TaskType = "API" | "HTML";
export type Method = "GET" | "POST" | "PUT";
export type Compute = "Lambda" | "EC2" | "Fargate" | "Batch";

export interface Task {
    shouldEnd: boolean;
    report: boolean;
    taskName: string;
    taskId: string;
    taskType: TaskType;
    taskClient?: number;
    url: string;
    method: Method;
    compute: Compute;
    KeyName?: string;
    InstanceType?: string;
    qps?: number;
    n?: number;
    c: number;
    taskDelaySeconds?: number;
    runInstanceBatch?: number;
    regions: string[];
    region: string;
    nPerClient?: number,
    timeoutMs: number;
    successCode: HttpStatusCode;
    startTime: string;
    createdAt: string;
    endTime: string;
    states?: any;
}

export function delay(startSeconds: number) {
    // has already passed the start second
    if (new Date().getSeconds() !== startSeconds) {
        return;
    }

    const waitingMs = 1000 - new Date().getMilliseconds();
    // console.log(JSON.stringify({
    //     from: startSeconds,
    //     to: startSeconds + 1,
    //     waitingMs,
    // }));
    return new Promise(resolve => setTimeout(resolve, waitingMs));
}


export async function getTaskGlobal(taskId: string, region: string) {
    const TableName = Table.tasks.tableName;

    const dynamodb = new AWS.DynamoDB.DocumentClient({region});
    const data = await dynamodb.get({
        TableName,
        Key: {
            taskId
        }
    } as any).promise();

    if (!data.Item) {
        throw new Error(`task ${taskId} not found`);
    }

    const task = data.Item;

    return (task.regions && task.regions.length) > 1
        ? await batchGet(TableName, {taskId}, task.regions)
        : [task];
}

export async function updateTaskState(taskId: string, arn: string, status: string) {
    const params = {
        TableName: Table.tasks.tableName,
        Key: {
            taskId
        },
        ExpressionAttributeNames: {
            '#jsonField': 'states',
            '#instanceId': arn
        },
        ExpressionAttributeValues: {
            ':newValue': status
        },
        UpdateExpression: 'SET #jsonField.#instanceId = :newValue',
        ReturnValues: 'UPDATED_NEW'
    };

    try {
        await dynamoDb.update(params).promise();
    } catch (e: any) {
        console.log({taskId, arn, status});
        console.log(`updateTaskState error: ${e.message}`);
    }

}
