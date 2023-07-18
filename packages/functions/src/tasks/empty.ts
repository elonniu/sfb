import {Table} from "sst/node/table";
import {batchDelete, dynamoDb} from "../lib/ddb";
import {batchStopExecutions} from "../lib/sf";
import {batchStopTasks} from "../lib/ecs";
import {bad, getTaskGlobal, ok} from "../common";
import {batchTerminateJobs} from "../lib/batch";

const TableName = Table.tasks.tableName;
const region = process.env.AWS_REGION || "";

export async function handler(event: any, context: any) {

    try {

        const data = await dynamoDb.scan({
            TableName
        }).promise();

        if (data.Items) {
            for (const item of data.Items) {
                const {taskId} = item;

                const globalTasks = await getTaskGlobal(taskId, region);

                if (globalTasks.length > 0) {
                    await batchStopTasks(globalTasks);
                    await batchTerminateJobs(globalTasks);
                    await batchStopExecutions(globalTasks);
                    await batchDelete(TableName, {taskId}, globalTasks[0]?.regions);
                }

            }
        }

        return ok(data.Items);
    } catch (e: any) {
        return bad(e, context);
    }

}
