import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";
import {v4 as uuidv4} from "uuid";
import {Task} from "./requestDispatch";
import {HttpStatusCode} from "axios";

const sf = new AWS.StepFunctions();

export const handler = ApiHandler(async (_evt) => {

    let task: Task = JSON.parse(_evt.body || "{}");

    if (!task.url || !task.timeout) {
        return jsonResponse({msg: "url, batch, timeout is empty"}, 400);
    }

    // batch and qps can not be both empty
    if (task.batch === undefined && task.qps === undefined) {
        return jsonResponse({msg: "batch and qps can not be both empty"}, 400);
    }

    // batch and qps can not be both set
    if (task.batch !== undefined && task.qps !== undefined) {
        return jsonResponse({msg: "batch and qps can not be both set"}, 400);
    }

    // batch must be greater than 0 and be integer
    if (task.batch !== undefined && (task.batch <= 0 || !Number.isInteger(task.batch))) {
        return jsonResponse({msg: "batch must be greater than 0 and be integer"}, 400);
    }

    // qps must be greater than 0 and be integer
    if (task.qps !== undefined && (task.qps <= 0 || !Number.isInteger(task.qps))) {
        return jsonResponse({msg: "qps must be greater than 0 and be integer"}, 400);
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
        task.endTime = new Date(new Date(task.startTime).getTime() + 3600 * 1000).toISOString();
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
    const taskId = uuidv4().toString();
    const params: StartExecutionInput = {
        stateMachineArn: process.env.SF || "",
        input: JSON.stringify({
            Payload: {
                ...task,
                shouldEnd: false,
                taskId,
            },
        }),
    };
    const state = await sf.startExecution(params).promise();
    const end = Date.now();

    return jsonResponse({
        taskId,
        latency: Number(end.toString()) - Number(start.toString()),
        payload: {...task},
        state,
    });

});
