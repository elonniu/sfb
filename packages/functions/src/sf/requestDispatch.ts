import {snsBatch} from "../lib/sns";
import {Topic} from "sst/node/topic";
import {delay, Task} from "../common";

export async function handler(event: any) {

    const {ExecutionId, input} = event;
    const task: Task = input.value;

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