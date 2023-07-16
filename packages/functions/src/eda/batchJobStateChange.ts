import {Task, updateTaskState} from "../common";

export async function handler(event: any) {

    const {detail: {jobId, status, container: {environment}}} = event;

    for (const env of environment) {
        if (env.name === "TASK") {
            const task = JSON.parse(env.value) as Task;
            await updateTaskState(task.taskId, jobId, status);
        }
    }

    return {};
}

