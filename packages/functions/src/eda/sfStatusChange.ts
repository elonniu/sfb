import {Task, updateStateStatus} from "../common";

export async function handler(event: any) {

    const {detail: {executionArn, status, input}} = event;

    const {Payload} = JSON.parse(input);

    const task: Task = Payload;

    await updateStateStatus(task.taskId, executionArn, status);

    return {};
}
