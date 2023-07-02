import {snsBatch} from "../lib/sns";
import {Topic} from "sst/node/topic";
import {delay, Task} from "../common";

export async function handler(event: any) {

    const {ExecutionId, input} = event;
    const task: Task = input.value;
    const startSeconds = new Date().getSeconds();

    // now between startTime and endTime
    const now = new Date().getTime();
    if (now < new Date(task.startTime).getTime()) {
        await delay(startSeconds);
        return {...task, shouldEnd: false};
    }

    if (now > new Date(task.endTime).getTime()) {
        return {shouldEnd: true};
    }

    if (task.n) {
        let list = [];
        for (let i = 0; i < task.n; i++) {
            list.push({...task});
        }
        await sendToSns(list);
        return {shouldEnd: true};
    }

    if (task.qps) {
        let list = [];
        for (let i = 0; i < task.qps; i++) {
            list.push({...task});
        }
        await sendToSns(list);
        await delay(startSeconds);
        return {...task, shouldEnd: false};
    }

    return {shouldEnd: true};
}

export async function sendToSns(tasks: Task[]) {
    const start = new Date().toISOString();
    await snsBatch(Topic.Topic.topicArn, tasks);
    const end = new Date().toISOString();
    console.log(`SnsBatch ${tasks.length} messages latency: ${new Date(end).getTime() - new Date(start).getTime()} ms`);
}
