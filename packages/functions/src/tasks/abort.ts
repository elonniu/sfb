import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import {batchStopExecutions} from "../lib/sf";
import {batchStopEc2s} from "../lib/ec2";
import {batchStopTasks} from "../lib/ecs";
import {getTaskGlobal} from "../common";
import {batchTerminateJobs} from "../lib/batch";

const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    const region = _evt.queryStringParameters?.region || current_region;

    const taskId = _evt.pathParameters?.id || "";

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        if (globalTasks) {
            await batchStopEc2s(globalTasks);
            await batchStopTasks(globalTasks);
            await batchTerminateJobs(globalTasks);
            await batchStopExecutions(globalTasks);
        }

        return jsonResponse({
            message: "task aborted",
            tasks: globalTasks
        });
    } catch (e: any) {
        return jsonResponse({
            error: e.message
        });
    }

});
