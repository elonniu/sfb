import {snsBatch} from "../lib/sns";
import {Topic} from "sst/node/topic";
import {delay, Task} from "../common";
import AWS from "aws-sdk";
import console from "console";

export const checkStepFunctionsStep = 5;

const stepFunctions = new AWS.StepFunctions();

export async function handler(event: any) {

    const {ExecutionId, input} = event;

    console.log(JSON.stringify({ExecutionId, input}));

    const task: Task = input.value;
    const invokeStart = new Date().toISOString();

    task.taskStep = task.taskStep ? task.taskStep++ : 1;

    let checkStepFunctionsCounter = 0;
    while (true) {
        if (new Date().getTime() > new Date(invokeStart).getTime() + 898 * 1000) {
            return {...task, shouldEnd: false};
        }

        checkStepFunctionsCounter++;
        if (checkStepFunctionsCounter === checkStepFunctionsStep) {
            const start = new Date().toISOString();
            const res = await stepFunctions.describeExecution({executionArn: ExecutionId}).promise();
            const end = new Date().toISOString();
            if (res && res.status !== 'RUNNING') {
                console.log(`return because execution is ${res.status}, check latency: ${new Date(end).getTime() - new Date(start).getTime()} ms`);
                return {shouldEnd: true};
            }
            checkStepFunctionsCounter = 0;
        }

        const startSeconds = new Date().getSeconds();

        // now between startTime and endTime
        const now = new Date().getTime();
        if (now < new Date(task.startTime).getTime()) {
            await delay(startSeconds);
            continue;
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
        }

    }


}

export async function sendToSns(tasks: Task[]) {
    const start = new Date().toISOString();
    await snsBatch(Topic.Topic.topicArn, tasks);
    const end = new Date().toISOString();
    console.log(JSON.stringify({
        snsMessages: tasks.length,
        latency: `${new Date(end).getTime() - new Date(start).getTime()} ms`,
    }));
}
