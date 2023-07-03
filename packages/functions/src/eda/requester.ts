import {requestBatch} from "../sf/request";
import {Task} from "../common";

export async function handler(event: any) {

    if (!event.Records) {
        return {};
    }

    for (let i = 0; i < event.Records.length; i++) {
        let item = event.Records[i];
        const task: Task = JSON.parse(item.Sns.Message);

        await requestBatch(task);

        if (task.delay !== undefined) {
            await delay(task.delay);
        }
    }

    return {};

}

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
