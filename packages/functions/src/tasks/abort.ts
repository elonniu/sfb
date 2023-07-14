import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";
import {batchGet} from "../lib/ddb";
import {batchStopStepFunctions} from "../lib/sf";
import {batchStopEc2s} from "../lib/ec2";
import {batchStopTasks} from "../lib/fargate";

const TableName = Table.tasks.tableName;
const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    const region = _evt.queryStringParameters?.region || current_region;

    const taskId = _evt.pathParameters?.id;

    try {
        const dynamodb = new AWS.DynamoDB.DocumentClient({region});
        const data = await dynamodb.get({
            TableName,
            Key: {
                taskId
            }
        } as any).promise();

        if (!data.Item) {
            return jsonResponse({msg: "task not found"}, 404);
        }

        const task = data.Item;

        const globalTasks = (task.regions && task.regions.length) > 1
            ? await batchGet(TableName, {taskId}, task.regions)
            : [task];

        // delete global tasks
        if (globalTasks) {
            await batchStopTasks(globalTasks);
            await batchStopStepFunctions(globalTasks);
            await batchStopEc2s(globalTasks);
        }

        return jsonResponse({
            message: "task aborted",
            task: globalTasks
        });
    } catch (e: any) {
        return jsonResponse({
            message: "task aborted",
            error: e.message
        });
    }

});
