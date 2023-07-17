import {HttpStatusCode} from "axios";
import {Table} from "sst/node/table";
import AWS from "aws-sdk";
import {batchGet, dynamoDb} from "./lib/ddb";
import {lambdaLogUrl, sortKeys} from "sst-helper";
import console from "console";
import process from "process";

export const SST_STAGE = process.env.SST_STAGE || "";
export const SST_APP = process.env.SST_APP || "";

export type TaskType = "API" | "HTML";
export type Method = "GET" | "POST" | "PUT";
export type Compute = "Lambda" | "EC2" | "Fargate" | "Batch";
export type Status = "Pending" | "Running" | "Failed" | "Done";

export interface Task {
    shouldEnd: boolean;
    report: boolean;
    name: string;
    taskId: string;
    type: TaskType;
    client?: number;
    url: string;
    method: Method;
    compute: Compute;
    keyName?: string;
    instanceType?: string;
    qps?: number;
    n?: number;
    c: number;
    delay?: number;
    regions: string[];
    region: string;
    nPerClient?: number,
    timeout: number;
    successCode: HttpStatusCode;
    startTime: string;
    createdAt: string;
    endTime: string;
    states?: any;
    status: Status;
}

export function delay(startSeconds: number) {
    // has already passed the start second
    if (new Date().getSeconds() !== startSeconds) {
        return;
    }

    const waitingMs = 1000 - new Date().getMilliseconds();
    return new Promise(resolve => setTimeout(resolve, waitingMs));
}


export async function getTaskGlobal(taskId: string | undefined, region: string) {

    if (!taskId) {
        throw new Error(`taskId is required`);
    }

    const TableName = Table.tasks.tableName;

    const dynamodb = new AWS.DynamoDB.DocumentClient({region});
    const data = await dynamodb.get({
        TableName,
        Key: {
            taskId
        }
    } as any).promise();

    if (!data.Item) {
        throw new Error(`Task ${taskId} not found`);
    }

    const task = data.Item;

    return (task.regions && task.regions.length) > 1
        ? await batchGet(TableName, {taskId}, task.regions)
        : [task];
}

export async function updateTaskState(taskId: string, arn: string, status: string) {

    const {Item} = await dynamoDb.get({
        TableName: Table.tasks.tableName,
        Key: {
            taskId
        }
    } as any).promise();

    if (!Item) {
        throw new Error(`Task ${taskId} not found`);
    }

    if (!Item.states) {
        return;
    }

    if (Item.states[arn] === undefined) {
        return;
    }

    const params = {
        TableName: Table.tasks.tableName,
        Key: {
            taskId
        },
        ExpressionAttributeNames: {
            '#states': 'states',
            '#status': 'status',
            '#instanceId': arn
        },
        ExpressionAttributeValues: {
            ':stateValue': status,
            ':newStatus': status
        },
        UpdateExpression: 'SET #states.#instanceId = :stateValue, #status = :newStatus',
        ReturnValues: 'UPDATED_NEW'
    };

    try {
        await dynamoDb.update(params).promise();
    } catch (e: any) {
        console.log({taskId, arn, status});
        console.log(`updateTaskState error: ${e.message}`);
    }

}

export function ok(data: any) {
    console.log(data);
    return sortKeys({success: true, data})
}

export function bad(e: any, context: any = undefined) {
    console.log({e, context});
    return sortKeys({
        success: false,
        msg: e.message,
        code: e.code,
        log: getLambdaLogUrl(context)
    })
}

export function getLambdaLogUrl(context: any = undefined) {
    if (context === undefined) {
        return context;
    }

    return lambdaLogUrl(context, process.env.AWS_REGION);
}
