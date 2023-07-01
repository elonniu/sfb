import * as console from "console";
import axios from "axios";
import {batchPut} from "./ddb";
import {Table} from "sst/node/table";

export async function handler(event: any) {

    if (!event.Records) {
        return {};
    }

    const list = [];

    for (let i = 0; i < event.Records.length; i++) {
        let item = event.Records[i];
        let message = '';
        const {url, timeout, taskId} = JSON.parse(item.Sns.Message);

        const start = Date.now();

        try {
            const {data} = await axios.get(url, {timeout: timeout ? timeout : 1000});
        } catch (e) {
            message = e.message;
            console.error(e.message);
        }

        const end = Date.now();

        list.push({
            id: item.Sns.MessageId,
            url,
            taskId,
            message,
            ms: Number(end.toString()) - Number(start.toString()),
            time: new Date().toISOString()
        });
    }

    await batchPut(Table.table.tableName, list);

    return {};

}
