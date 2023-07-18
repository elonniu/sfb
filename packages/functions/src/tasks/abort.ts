import {batchStopExecutions} from "../lib/sf";
import {batchStopTasks} from "../lib/ecs";
import {bad, getTaskGlobal, ok} from "../common";
import {batchTerminateJobs} from "../lib/batch";

const region = process.env.AWS_REGION || "";

export async function handler(event: any, context: any) {

    const {taskId} = event;

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        if (globalTasks) {
            await batchStopTasks(globalTasks);
            await batchTerminateJobs(globalTasks);
            await batchStopExecutions(globalTasks);
        }

        return ok(globalTasks);
    } catch (e: any) {
        return bad(e, context);
    }

}
