import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";

const sf = new AWS.StepFunctions();
const TableName = Table.tasks.tableName;
const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    const region = _evt.queryStringParameters?.region || current_region;

    const dynamodb = new AWS.DynamoDB.DocumentClient({region});

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
                    executionArn: state.executionArn.replace(current_region, region)
                }).promise();
            }
        }
    }

    return jsonResponse({
        message: "task stopped"
    });

});
