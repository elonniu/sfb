import {snsBatch} from "./sns";
import {Topic} from "sst/node/topic";
import console from "console";

export interface Task {
    shouldEnd: boolean;
    taskId: string;
    url: string;
    batch?: number;
    qps?: number;
    timeout: number;
    startTime: string;
    endTime: string;
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

    if (task.batch) {
        let sqsMessages = [];
        for (let i = 0; i < task.batch; i++) {
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
    console.log(`delay ${ms} milliseconds until the next second`);
    return new Promise(resolve => setTimeout(resolve, ms));
}
