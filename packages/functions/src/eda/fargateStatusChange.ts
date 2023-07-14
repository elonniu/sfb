import {Task, updateStateStatus} from "../common";

export async function handler(event: any) {

    const {detail: {taskArn, overrides, lastStatus}} = event;

    if (overrides.containerOverrides) {
        for (const containerOverride of overrides.containerOverrides) {
            const {environment} = containerOverride;
            for (const env of environment) {
                if (env.name === "TASK") {
                    const task = JSON.parse(env.value) as Task;

                    await updateStateStatus(task.taskId, taskArn, lastStatus);

                }
            }
        }
    }

    return {};
}
