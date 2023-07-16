import {bad, getTaskGlobal, ok} from "../common";

const region = process.env.AWS_REGION || "";

export async function handler(event: any) {

    const {taskId} = event;

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        let task = {...globalTasks[0]};

        task.states = {};

        for (let i = 0; i < globalTasks.length; i++) {
            const globalTask = globalTasks[i];
            task.states[globalTask.region] = globalTask.states;
        }

        return ok(task);
    } catch (e: any) {
        return bad(e);
    }

}
