import {Task} from "../sf/requestDispatch";
import {requestBatch} from "../sf/request";

export async function handler(event: any) {

    if (!event.Records) {
        return {};
    }

    for (let i = 0; i < event.Records.length; i++) {
        let item = event.Records[i];
        const task: Task = JSON.parse(item.Sns.Message);

        await requestBatch(task);
    }

    return {};

}
