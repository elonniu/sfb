import * as console from "console";
import axios from "axios";
import {batchPut} from "./ddb";
import {Table} from "sst/node/table";
import {Task} from "./requestDispatch";

export async function handler(event: any) {

    if (!event.Records) {
        return {};
    }

    const list = [];

    for (let i = 0; i < event.Records.length; i++) {
        let item = event.Records[i];
        let message = '';
        let success = false;
        const task: Task = JSON.parse(item.Sns.Message);

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
            id: item.Sns.MessageId,
            taskId: task.taskId,
            url: task.url,
            success,
            message,
            ms: Number(end.toString()) - Number(start.toString()),
            time: new Date().toISOString()
        });
    }

    await batchPut(Table.logs.tableName, list);

    return {};

}
