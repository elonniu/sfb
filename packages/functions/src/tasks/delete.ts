import {Table} from "sst/node/table";
import {batchDelete} from "../lib/ddb";
import {batchStopExecutions} from "../lib/sf";
import {batchStopTasks} from "../lib/ecs";
import {bad, getTaskGlobal, ok} from "../common";
import {batchTerminateJobs} from "../lib/batch";

const TableName = Table.tasks.tableName;
const region = process.env.AWS_REGION || "";

export async function handler(event: any, context: any) {

    const {taskId} = event;

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        if (globalTasks.length > 0) {
            await batchStopTasks(globalTasks);
            await batchTerminateJobs(globalTasks);
            await batchStopExecutions(globalTasks);
            await batchDelete(TableName, {taskId}, globalTasks[0]?.regions);
        }

        return ok(globalTasks);
    } catch (e: any) {
        return bad(e, context);
    }

}
