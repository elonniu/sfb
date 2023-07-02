import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";

const dynamodb = new AWS.DynamoDB.DocumentClient();
const sf = new AWS.StepFunctions();
const TableName = Table.tasks.tableName;

export const handler = ApiHandler(async (_evt) => {

    const taskId = _evt.pathParameters?.id;

    // get item from TableName
    const data = await dynamodb.get({
        TableName,
        Key: {
            taskId
        }
    } as any).promise();

    if (!data.Item) {
        return jsonResponse({msg: "task not found"}, 404);
    }

    // stop step functions Execution
    if (data.Item.states) {
        for (let state of data.Item.states) {
            if (state.executionArn) {
                await sf.stopExecution({
                    executionArn: state.executionArn
                }).promise();
            }
        }
    }

    // delete item
    await dynamodb.delete({
        TableName,
        Key: {
            taskId
        }
    } as any).promise();

    return jsonResponse({
        message: "task deleted"
    });

});
