import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import {Table} from "sst/node/table";
import {batchDelete} from "../lib/ddb";
import {batchStopStepFunctions} from "../lib/sf";
import {batchStopEc2s} from "../lib/ec2";
import {batchStopTasks} from "../lib/fargate";
import {getTaskGlobal} from "../common";

const TableName = Table.tasks.tableName;
const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    const region = _evt.queryStringParameters?.region || current_region;

    const taskId = _evt.pathParameters?.id || "";

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        // delete global tasks
        if (globalTasks.length > 0) {
            await batchStopEc2s(globalTasks);
            await batchStopTasks(globalTasks);
            await batchStopStepFunctions(globalTasks);
            await batchDelete(TableName, {taskId}, globalTasks[0]?.regions);
        }

        return jsonResponse({
            message: "task deleted",
            tasks: globalTasks
        });
    } catch (e: any) {
        return jsonResponse({
            error: e.message
        });
    }

});
