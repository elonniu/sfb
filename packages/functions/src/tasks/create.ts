import {ApiHandler} from "sst/node/api";
import {executionUrl, jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";
import {v4 as uuidv4} from "uuid";
import {StatesList, Task} from "../common";
import {HttpStatusCode} from "axios";
import {Table} from "sst/node/table";
import {startExecutionBatch} from "../lib/sf";
import {checkStackDeployment} from "../lib/cf";

const dispatchStateMachineArn = process.env.DISPATCH_SF_ARN || "";
const requestStateMachineArn = process.env.REQUEST_SF_ARN || "";
const current_region = process.env.AWS_REGION || "";

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

    task.taskType = task.taskType.toUpperCase();

    if (!task.url || !task.timeout) {
        return jsonResponse({msg: "url, timeout is empty"}, 400);
    }

    // validate url
    try {
        new URL(task.url);
    } catch (e) {
        return jsonResponse({msg: "url is invalid"}, 400);
    }

    if (!task.method) {
        return jsonResponse({msg: "method is empty"}, 400);
    }
    task.method = task.method.toUpperCase();

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

    // delay must be greater than 0 and be integer
    if (task.delay !== undefined && (task.delay <= 0 || !Number.isInteger(task.delay))) {
        return jsonResponse({msg: "delay must be greater than 0 and be integer"}, 400);
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

    // endTime must be less than startTime + 48 hours
    if (new Date(task.startTime).getTime() + 3600 * 48 * 1000 < new Date(task.endTime).getTime()) {
        return jsonResponse({msg: "endTime must be less than startTime + 48 hours"}, 400);
    }

    task.taskId = uuidv4().toString();

    if (!task.regions) {
        task.regions = [current_region];
    } else {
        const deployRegions = await checkStackDeployment(task.regions);
        // list task.regions are not in deployRegions
        const notDeployRegions = task.regions.filter((region) => !deployRegions.includes(region));
        if (notDeployRegions.length > 0) {
            return jsonResponse({
                msg: `ServerlessBench not in [${notDeployRegions.join(', ')}] yet, available regions [${deployRegions.join(', ')}]`
            }, 400);
        }
    }

    try {
        const start = Date.now();
        const states = await dispatchRegions(task);
        const end = Date.now();

        return jsonResponse({
            latency: Number(end.toString()) - Number(start.toString()),
            ...task,
            states,
        });

    } catch (e: any) {
        return jsonResponse({msg: e.message}, 500);
    }

});

export async function dispatchRegions(task: Task) {
    let statesList: StatesList = {};

    for (const region of task.regions) {

        task.region = region;

        let sfExe: StartExecutionInput[] = [];

        if (task.n && task.c) {
            for (let i = 0; i < task.c; i++) {
                const taskClient = i + 1;
                sfExe.push({
                    name: `request_${task.taskName}_${task.taskId}-${taskClient}`,
                    stateMachineArn: requestStateMachineArn.replace(current_region, region),
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
                name: `${task.qps ? 'qps' : 'batch'}_${task.taskName}_${task.taskId}`,
                stateMachineArn: dispatchStateMachineArn.replace(current_region, region),
                input: JSON.stringify({
                    Payload: {
                        ...task,
                        taskClient: 0,
                        shouldEnd: false,
                    },
                }),
            });
        }
        const states = await startExecutionBatch(region, sfExe);

        const dynamodb = new AWS.DynamoDB.DocumentClient({region});
        await dynamodb.put({
            TableName: Table.tasks.tableName,
            Item: {
                ...task,
                states,
                createdAt: new Date().toISOString(),
            },
        } as AWS.DynamoDB.DocumentClient.PutItemInput).promise();

        states.forEach((state) => {
            state.executionUrl = executionUrl(state.executionArn, region);
        });

        statesList[region] = states;
    }

    return statesList;
}
