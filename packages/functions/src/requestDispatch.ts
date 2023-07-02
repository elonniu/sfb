import {snsBatch} from "./lib/sns";
import {Topic} from "sst/node/topic";
import console from "console";
import {HttpStatusCode} from "axios";
import {Arn, StartExecutionOutput, Timestamp} from "aws-sdk/clients/stepfunctions";

export interface Task {
    shouldEnd: boolean;
    taskId: string;
    taskType: string;
    url: string;
    qps?: number;
    n?: number;
    left?: number;
    c?: number;
    client?: number;
    timeout: number;
    successCode: HttpStatusCode;
    startTime: string;
    createdAt: string;
    endTime: string;
    executionArn?: Arn;
    startDate?: Timestamp;
    states: StartExecutionOutput[];
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

function delay() {
    // get the milliseconds until the next second.
    const ms = 1000 - new Date().getMilliseconds();
    console.log(`waiting for start, delay ${ms} milliseconds until the next second`);
    return new Promise(resolve => setTimeout(resolve, ms));
}
