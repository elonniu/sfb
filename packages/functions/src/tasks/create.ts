import {ApiHandler} from "sst/node/api";
import {jsonResponse, nanoid} from "sst-helper";
import AWS from "aws-sdk";
import {Task} from "../common";
import {HttpStatusCode} from "axios";
import {checkStackDeployment} from "../lib/cf";
import process from "process";

const current_region = process.env.AWS_REGION || "";

const {
    TASK_GENERATE_FUNCTION
} = process.env;

export const handler = ApiHandler(async (_evt) => {

    let task: Task = JSON.parse(_evt.body || "{}");

    if (_evt.requestContext.http.sourceIp !== process.env.SOURCE_IP) {
        return jsonResponse({msg: "sourceIp is not allowed"}, 400);
    }

    try {
        task = await checkTasks(task);
        await dispatchTask(task);
        return jsonResponse(task);
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

        if (task.regions.length > 5) {
            throw new Error("regions must be less than 5");
        }

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

    task.states = {};

    for (const region of task.regions) {

        const lambda = new AWS.Lambda({region});

        const res = await lambda.invoke({
            FunctionName: TASK_GENERATE_FUNCTION || "",
            Payload: JSON.stringify(task),
            InvocationType: 'RequestResponse'
        }).promise();

        task.states[region] = JSON.parse(res.Payload as string);
    }

}
