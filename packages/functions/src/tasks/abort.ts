import {sortKeys} from "sst-helper";
import {batchStopExecutions} from "../lib/sf";
import {batchStopEc2s} from "../lib/ec2";
import {batchStopTasks} from "../lib/ecs";
import {getTaskGlobal} from "../common";
import {batchTerminateJobs} from "../lib/batch";

const region = process.env.AWS_REGION || "";

export async function handler(event: any) {

    const {taskId} = event;

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        if (globalTasks) {
            await batchStopEc2s(globalTasks);
            await batchStopTasks(globalTasks);
            await batchTerminateJobs(globalTasks);
            await batchStopExecutions(globalTasks);
        }

        return sortKeys({
            message: "task aborted",
        });
    } catch (e: any) {
        return sortKeys({
            error: e.message
        });
    }

}
