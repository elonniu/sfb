import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import {Table} from "sst/node/table";
import {batchDelete} from "../lib/ddb";
import {batchStopExecutions} from "../lib/sf";
import {batchStopEc2s} from "../lib/ec2";
import {batchStopTasks} from "../lib/ecs";
import {getTaskGlobal} from "../common";
import {batchTerminateJobs} from "../lib/batch";

const TableName = Table.tasks.tableName;
const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    const region = _evt.queryStringParameters?.region || current_region;

    const taskId = _evt.pathParameters?.id || "";

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        if (globalTasks.length > 0) {
            await batchStopEc2s(globalTasks);
            await batchStopTasks(globalTasks);
            await batchTerminateJobs(globalTasks);
            await batchStopExecutions(globalTasks);
            await batchDelete(TableName, {taskId}, globalTasks[0]?.regions);
        }

        return jsonResponse({
            message: "task deleted",
        });
    } catch (e: any) {
        return jsonResponse({
            error: e.message
        });
    }

});
