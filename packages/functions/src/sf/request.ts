import console from "console";
import {delay, Task} from "../common";
import axios from "axios";
import {batchPut} from "../lib/ddb";
import {Table} from "sst/node/table";
import {v4 as uuidv4} from "uuid";

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

    await requestBatch(task, 1);

    if (task.currentStateMachineExecutedLeft !== undefined) {
        task.currentStateMachineExecutedLeft--;
        if (task.currentStateMachineExecutedLeft === 0) {
            return {shouldEnd: true};
        }
    }

    return {...task, shouldEnd: false};
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
            dataLength = data.toString().length;
            success = status === task.successCode;
        } catch (e) {
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
