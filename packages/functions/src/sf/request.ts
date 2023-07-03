import console from "console";
import {delay, Task} from "../common";
import axios from "axios";
import {batchPut} from "../lib/ddb";
import {Table} from "sst/node/table";
import {v4 as uuidv4} from "uuid";
import AWS from "aws-sdk";

const stepFunctions = new AWS.StepFunctions();

export async function handler(event: any) {

    const {ExecutionId, input} = event;
    const task: Task = input.value;
    const invokeStart = new Date().toISOString();

    console.log(JSON.stringify({ExecutionId, input}));

    task.taskStep = task.taskStep ? task.taskStep++ : 1;

    let checkStepFunctionsStatus = 0;
    while (true) {
        if (new Date().getTime() > new Date(invokeStart).getTime() + 898 * 1000) {
            return {...task, shouldEnd: false};
        }

        checkStepFunctionsStatus++;
        if (checkStepFunctionsStatus === 10) {
            const start = new Date().toISOString();
            const res = await stepFunctions.describeExecution({executionArn: ExecutionId}).promise();
            const end = new Date().toISOString();
            if (res && res.status !== 'RUNNING') {
                console.log(`return because execution is ${res.status}, check latency: ${new Date(end).getTime() - new Date(start).getTime()} ms`);
                return {shouldEnd: true};
            }
            checkStepFunctionsStatus = 0;
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

        await requestBatch(task);

        if (task.currentStateMachineExecutedLeft !== undefined) {
            task.currentStateMachineExecutedLeft--;
            if (task.currentStateMachineExecutedLeft === 0) {
                return {shouldEnd: true};
            }
        }
    }

}

export async function requestBatch(task: Task, batch: number = 1) {
    const list = [];

    for (let i = 0; i < batch; i++) {
        let message = '';
        let dataLength = 0;
        let success = false;

        const start = Date.now();
        try {
            const {data, status} = await axios.get(task.url, {timeout: task.timeout});
            console.log(data);
            dataLength = data.toString().length;
            success = status === task.successCode;
        } catch (e: any) {
            message = e.message;
            console.error(e.message);
        }
        const end = Date.now();

        if (task.report) {
            list.push({
                id: uuidv4().toString(),
                taskId: task.taskId,
                taskClient: task.taskClient,
                url: task.url,
                dataLength,
                success,
                message,
                latency: Number(end.toString()) - Number(start.toString()),
                time: new Date().toISOString()
            });
        }
    }

    await batchPut(Table.logs.tableName, list);
}
