import {ApiHandler} from "sst/node/api";
import {executionUrl, jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";
import {v4 as uuidv4} from "uuid";
import {Task} from "../common";
import {HttpStatusCode} from "axios";
import {Table} from "sst/node/table";
import {startExecutionBatch} from "../lib/sf";

const dynamodb = new AWS.DynamoDB.DocumentClient();
const sf = new AWS.StepFunctions();
const dispatchStateMachineArn = process.env.DISPATCH_SF_ARN || "";
const requestStateMachineArn = process.env.REQUEST_SF_ARN || "";

export const handler = ApiHandler(async (_evt) => {

    let task: Task = JSON.parse(_evt.body || "{}");

    if (task.report) {
        task.report = true;
    }

    if (!task.taskName) {
        return jsonResponse({msg: "taskName is empty"}, 400);
    }

    if (!task.taskType) {
        return jsonResponse({msg: "taskType is empty"}, 400);
    }

    if (!task.url || !task.timeout) {
        return jsonResponse({msg: "url, timeout is empty"}, 400);
    }

    if (!task.method) {
        return jsonResponse({msg: "method is empty"}, 400);
    }

    // n and qps can not be both empty
    if (task.n === undefined && task.qps === undefined) {
        return jsonResponse({msg: "n and qps can not be both empty"}, 400);
    }

    // n and qps can not be both set
    if (task.n !== undefined && task.qps !== undefined) {
        return jsonResponse({msg: "n and qps can not be both set"}, 400);
    }

    // n must be greater than 0 and be integer
    if (task.n !== undefined && (task.n <= 0 || !Number.isInteger(task.n))) {
        return jsonResponse({msg: "n must be greater than 0 and be integer"}, 400);
    }

    // c must be greater than 0 and be integer
    if (task.c !== undefined && (task.c <= 0 || !Number.isInteger(task.c))) {
        return jsonResponse({msg: "c must be greater than 0 and be integer"}, 400);
    }

    // c must be less than n
    if (task.c !== undefined && task.n !== undefined && task.c > task.n) {
        return jsonResponse({msg: "c must be less than n"}, 400);
    }

    // qps must be greater than 0 and be integer
    if (task.qps !== undefined && (task.qps <= 0 || !Number.isInteger(task.qps))) {
        return jsonResponse({msg: "qps must be greater than 0 and be integer"}, 400);
    }

    if (task.timeout === undefined) {
        task.timeout = 1000;
    }

    // timeout must be greater than 0 and be integer
    if (task.timeout <= 0 || !Number.isInteger(task.timeout)) {
        return jsonResponse({msg: "timeout must be greater than 0 and be integer"}, 400);
    }

    if (!Object.values(HttpStatusCode).includes(task.successCode)) {
        return jsonResponse({msg: `successCode must be in [${Object.values(HttpStatusCode).join(',')}]`}, 400);
    }

    // the startTime and endTime must be time string and greater than now
    const now = new Date().getTime();
    if (task.startTime) {
        // startTime must be greater than now - 1 hours
        if (now - 3600 * 1000 > new Date(task.startTime).getTime()) {
            return jsonResponse({msg: "startTime must be greater than now - 1 hours"}, 400);
        }
        task.startTime = new Date(new Date(task.startTime).getTime()).toISOString();
    } else {
        task.startTime = new Date().toISOString();
    }

    if (task.endTime) {
        if (now > new Date(task.endTime).getTime()) {
            return jsonResponse({msg: "endTime must be greater than now"}, 400);
        }
        task.endTime = new Date(new Date(task.endTime).getTime()).toISOString();
    } else {
        task.endTime = new Date(new Date(task.startTime).getTime() + 600 * 1000).toISOString();
    }

    // endTime must be greater than startTime
    if (new Date(task.startTime).getTime() > new Date(task.endTime).getTime()) {
        return jsonResponse({msg: "endTime must be greater than startTime"}, 400);
    }

    // endTime must be less than startTime + 24 hours
    if (new Date(task.startTime).getTime() + 3600 * 24 * 1000 < new Date(task.endTime).getTime()) {
        return jsonResponse({msg: "endTime must be less than startTime + 24 hours"}, 400);
    }

    const start = Date.now();
    task.taskId = uuidv4().toString();

    let sfExe: StartExecutionInput[] = [];

    if (task.n && task.c) {
        for (let i = 0; i < task.c; i++) {
            const taskClient = i + 1;
            sfExe.push({
                name: "request-" + task.taskId + "-" + taskClient,
                stateMachineArn: requestStateMachineArn,
                input: JSON.stringify({
                    Payload: {
                        ...task,
                        taskClient,
                        perStateMachineExecuted: Math.ceil(task.n / task.c),
                        currentStateMachineExecutedLeft: Math.ceil(task.n / task.c),
                        shouldEnd: false,
                    },
                }),
            });
        }
    } else {
        sfExe.push({
            name: "dispatch-" + task.taskId,
            stateMachineArn: dispatchStateMachineArn,
            input: JSON.stringify({
                Payload: {
                    ...task,
                    taskClient: 0,
                    shouldEnd: false,
                },
            }),
        });
    }

    task.states = await startExecutionBatch(sfExe);

    const end = Date.now();

    await dynamodb.put({
        TableName: Table.tasks.tableName,
        Item: {
            ...task,
            createdAt: new Date().toISOString(),
        },
    } as AWS.DynamoDB.DocumentClient.PutItemInput).promise();

    task.states.forEach((state) => {
        state.executionUrl = executionUrl(state.executionArn, process.env.AWS_REGION || "");
    });

    return jsonResponse({
        latency: Number(end.toString()) - Number(start.toString()),
        task: {...task},
    });

});
