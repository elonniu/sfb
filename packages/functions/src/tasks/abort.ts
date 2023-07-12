import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";
import {batchGet} from "../lib/ddb";
import {batchStop} from "../lib/sf";
import {batchStopEc2} from "../lib/ec2";

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
            let listStop = [];
            for (let current of globalTasks) {
                if (current && current.states) {
                    for (let state of current.states) {
                        listStop.push({
                            region: current.region,
                            executionArn: state.executionArn
                        });
                    }
                }
                if (current && current.ec2Instances) {
                    await batchStopEc2(current.ec2Instances, current.region);
                }
            }
            await batchStop(listStop);
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
