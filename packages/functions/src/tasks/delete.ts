import {sortKeys} from "sst-helper";
import {Table} from "sst/node/table";
import {batchDelete} from "../lib/ddb";
import {batchStopExecutions} from "../lib/sf";
import {batchStopEc2s} from "../lib/ec2";
import {batchStopTasks} from "../lib/ecs";
import {getTaskGlobal} from "../common";
import {batchTerminateJobs} from "../lib/batch";

const TableName = Table.tasks.tableName;
const region = process.env.AWS_REGION || "";

export async function handler(event: any) {

    const {taskId} = event;

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        if (globalTasks.length > 0) {
            await batchStopEc2s(globalTasks);
            await batchStopTasks(globalTasks);
            await batchTerminateJobs(globalTasks);
            await batchStopExecutions(globalTasks);
            await batchDelete(TableName, {taskId}, globalTasks[0]?.regions);
        }

        return sortKeys({
            message: "Task deleted",
        });
    } catch (e: any) {
        return sortKeys({
            error: e.message
        });
    }

}
