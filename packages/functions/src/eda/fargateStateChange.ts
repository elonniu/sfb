import {Task, updateTaskState} from "../common";
import console from "console";

export async function handler(event: any) {

    const {detail: {taskArn, overrides, lastStatus}} = event;

    console.log(event.detail);

    if (overrides.containerOverrides) {
        for (const containerOverride of overrides.containerOverrides) {
            const {environment} = containerOverride;
            for (const env of environment) {
                if (env.name === "TASK") {
                    const task = JSON.parse(env.value) as Task;
                    await updateTaskState(task.taskId, taskArn, lastStatus);
                }
            }
        }
    }

    return {};
}
