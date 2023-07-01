import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";

const sf = new AWS.StepFunctions();

export const handler = ApiHandler(async (_evt) => {

    const body = JSON.parse(_evt.body || "[]");
    let {url, batch, timeout, startTime, endTime, qps} = body;

    if (!url || !timeout) {
        return jsonResponse({msg: "url, batch, timeout is empty"}, 400);
    }

    // batch and qps can not be both empty
    if (batch === undefined && qps === undefined) {
        return jsonResponse({msg: "batch and qps can not be both empty"}, 400);
    }

    // batch and qps can not be both set
    if (batch !== undefined && qps !== undefined) {
        return jsonResponse({msg: "batch and qps can not be both set"}, 400);
    }

    // batch must be greater than 0 and be integer
    if (batch !== undefined && (batch <= 0 || !Number.isInteger(batch))) {
        return jsonResponse({msg: "batch must be greater than 0 and be integer"}, 400);
    }

    // qps must be greater than 0 and be integer
    if (qps !== undefined && (qps <= 0 || !Number.isInteger(qps))) {
        return jsonResponse({msg: "qps must be greater than 0 and be integer"}, 400);
    }

    // the startTime and endTime must be time string and greater than now
    const now = new Date().getTime();
    if (startTime) {
        // startTime must be greater than now - 1 hours
        if (now - 3600 * 1000 > new Date(startTime).getTime()) {
            return jsonResponse({msg: "startTime must be greater than now - 1 hours"}, 400);
        }
        startTime = new Date(new Date(startTime).getTime()).toISOString();
    } else {
        startTime = new Date().toISOString();
    }

    if (endTime) {
        if (now > new Date(endTime).getTime()) {
            return jsonResponse({msg: "endTime must be greater than now"}, 400);
        }
        endTime = new Date(new Date(endTime).getTime()).toISOString();
    } else {
        endTime = new Date(new Date(startTime).getTime() + 3600 * 1000).toISOString();
    }

    // endTime must be greater than startTime
    if (new Date(startTime).getTime() > new Date(endTime).getTime()) {
        return jsonResponse({msg: "endTime must be greater than startTime"}, 400);
    }

    // endTime must be less than startTime + 24 hours
    if (new Date(startTime).getTime() + 3600 * 24 * 1000 < new Date(endTime).getTime()) {
        return jsonResponse({msg: "endTime must be less than startTime + 24 hours"}, 400);
    }

    const start = Date.now();
    const params: StartExecutionInput = {
        stateMachineArn: process.env.SF || "",
        input: JSON.stringify({
            Payload: {
                shouldEnd: false,
                url,
                batch,
                timeout,
                startTime,
                endTime,
                qps
            },
        }),
    };
    await sf.startExecution(params).promise();
    const end = Date.now();

    return jsonResponse({
        payload: {
            url,
            batch,
            timeout,
            startTime,
            endTime,
            qps
        },
        latency: Number(end.toString()) - Number(start.toString()),
    });

});
