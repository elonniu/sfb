import {snsBatch} from "../lib/sns";
import {Topic} from "sst/node/topic";
import {delay, Task} from "../common";
import AWS from "aws-sdk";

const stepFunctions = new AWS.StepFunctions();

export async function handler(event: any) {

    const {ExecutionId, input} = event;

    const task: Task = input.value;
    const invokeStart = new Date().toISOString();

    task.taskStep = task.taskStep ? task.taskStep++ : 1;

    let checkStepFunctionsStatus = 0;
    while (true) {
        if (new Date().getTime() > new Date(invokeStart).getTime() + 898 * 1000) {
            return {...task, shouldEnd: false};
        }

        checkStepFunctionsStatus++;
        if (checkStepFunctionsStatus === 10) {
            const res = await stepFunctions.describeExecution({executionArn: ExecutionId}).promise();
            if (res && res.status !== 'RUNNING') {
                return {shouldEnd: true};
            }
            checkStepFunctionsStatus = 0;
        }

        const startSeconds = new Date().getSeconds();

        // now between startTime and endTime
        const now = new Date().getTime();
        if (now < new Date(task.startTime).getTime()) {
            await delay(ExecutionId, startSeconds);
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
            await sendToSns(ExecutionId, list);
            return {shouldEnd: true};
        }

        if (task.qps) {
            let list = [];
            for (let i = 0; i < task.qps; i++) {
                list.push({...task});
            }
            await sendToSns(ExecutionId, list);
            await delay(ExecutionId, startSeconds);
        }

    }


}

export async function sendToSns(executionId: string, tasks: Task[]) {
    const start = new Date().toISOString();
    await snsBatch(Topic.Topic.topicArn, tasks);
    const end = new Date().toISOString();
    // console.log(JSON.stringify({
    //     snsMessages: tasks.length,
    //     latency: `${new Date(end).getTime() - new Date(start).getTime()} ms`,
    //     executionId
    // }));
}
