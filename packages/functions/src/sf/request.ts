import console from "console";
import {Task} from "../requestDispatch";
import axios from "axios/index";
import {batchPut} from "../lib/ddb";
import {Table} from "sst/node/table";
import {v4 as uuidv4} from "uuid";

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

    const list = [];

    for (let i = 0; i < 1; i++) {
        let message = '';
        let success = false;

        const start = Date.now();
        try {
            const {data, status} = await axios.get(task.url, {timeout: task.timeout ? task.timeout : 1000});
            success = status === task.successCode;
        } catch (e) {
            message = e.message;
            console.error(e.message);
        }
        const end = Date.now();

        list.push({
            id: uuidv4().toString(),
            taskId: task.taskId,
            url: task.url,
            success,
            message,
            ms: Number(end.toString()) - Number(start.toString()),
            time: new Date().toISOString()
        });
    }

    if (task.left) {
        task.left--;
        if (task.left === 0) {
            return {shouldEnd: true};
        }
    }

    await batchPut(Table.logs.tableName, list);

    return {...task, shouldEnd: false};
}

function delay() {
    // get the milliseconds until the next second.
    const ms = 1000 - new Date().getMilliseconds();
    console.log(`waiting for start, delay ${ms} milliseconds until the next second`);
    return new Promise(resolve => setTimeout(resolve, ms));
}
