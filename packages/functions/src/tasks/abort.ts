import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import {batchStopStepFunctions} from "../lib/sf";
import {batchStopEc2s} from "../lib/ec2";
import {batchStopTasks} from "../lib/fargate";
import {getTaskGlobal} from "../common";

const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    const region = _evt.queryStringParameters?.region || current_region;

    const taskId = _evt.pathParameters?.id || "";

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        // delete global tasks
        if (globalTasks) {
            await batchStopTasks(globalTasks);
            await batchStopStepFunctions(globalTasks);
            await batchStopEc2s(globalTasks);
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
