import {snsBatch} from "../lib/sns";
import {Topic} from "sst/node/topic";
import console from "console";
import {HttpStatusCode} from "axios";
import {StartExecutionOutput} from "aws-sdk/clients/stepfunctions";
import {delay} from "./request";

export interface Task {
    shouldEnd: boolean;
    report: boolean;
    taskId: string;
    taskType: string;
    url: string;
    method: string;
    qps?: number;
    n?: number;
    perStateMachineExecuted?: number,
    currentStateMachineExecutedLeft?: number,
    c?: number;
    taskClient?: number;
    timeout: number;
    successCode: HttpStatusCode;
    startTime: string;
    createdAt: string;
    endTime: string;
    states?: StartExecutionOutput[];
}

export async function handler(event: any) {

    const task: Task = event.Payload;

    console.log(task);

    // now between startTime and endTime
    const now = new Date().getTime();
    if (now < new Date(task.startTime).getTime()) {
        await delay();
        return {...task, shouldEnd: false};
    }

    if (now > new Date(task.endTime).getTime()) {
        return {shouldEnd: true};
    }

    if (task.n) {
        let sqsMessages = [];
        for (let i = 0; i < task.n; i++) {
            sqsMessages.push({...task});
        }
        await snsBatch(Topic.Topic.topicArn, sqsMessages);
        return {shouldEnd: true};
    }

    if (task.qps) {
        let sqsMessages = [];
        for (let i = 0; i < task.qps; i++) {
            sqsMessages.push({...task});
        }
        await snsBatch(Topic.Topic.topicArn, sqsMessages);

        await delay();
        return {...task, shouldEnd: false};
    }

    return {shouldEnd: true};
}
