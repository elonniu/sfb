import {Task} from "../common";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";

const dynamodb = new AWS.DynamoDB.DocumentClient();
const TableName = Table.tasks.tableName;

export async function handler(event: any) {

    const {detail: {executionArn, status, input}} = event;

    const {Payload} = JSON.parse(input);

    const task: Task = Payload;

    const data = await dynamodb.get({
        TableName,
        Key: {
            taskId: task.taskId
        }
    } as any).promise();

    if (data.Item) {

        for (let i = 0; i < data.Item.states.length; i++) {
            const state = data.Item.states[i];
            if (state.executionArn === executionArn) {
                state.status = status;
                break;
            }
        }

        await dynamodb.put({
            TableName,
            Item: data.Item
        }).promise();

    }

    return {};
}
