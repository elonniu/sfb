import {ApiHandler} from "sst/node/api";
import {executionUrl, jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";

const dynamodb = new AWS.DynamoDB.DocumentClient();
const aws_region = process.env.AWS_REGION || "";
const TableName = Table.tasks.tableName;

export const handler = ApiHandler(async (_evt) => {

    // get all items from the table
    const data = await dynamodb.scan({
        TableName
    }).promise();

    // desc by createdAt
    data.Items && data.Items.sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    data.Items && data.Items.forEach((item: any) => {
        item.states && item.states.forEach((state: any) => {
            state.executionUrl = executionUrl(state.executionArn, aws_region);
        });
    });

    return jsonResponse({
        ...data
    });

});
