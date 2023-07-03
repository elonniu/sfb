import {ApiHandler} from "sst/node/api";
import {executionUrl, jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";

const TableName = Table.tasks.tableName;
const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    const region = _evt.queryStringParameters?.region || current_region;

    const dynamodb = new AWS.DynamoDB.DocumentClient({region});

    try {
        const data = await dynamodb.scan({
            TableName
        }).promise();

        // desc by createdAt
        data.Items && data.Items.sort((a, b) => {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        data.Items && data.Items.forEach((item: any) => {
            item.status = "SUCCEEDED";
            item.states && item.states.forEach((state: any) => {
                state.executionUrl = executionUrl(state.executionArn, region);
                if (state.status === "WAITING") {
                    item.status = "WAITING";
                }
                if (state.status === "RUNNING") {
                    item.status = "RUNNING";
                }
            });
        });

        return jsonResponse({
            ...data
        });
    } catch (e: any) {
        console.error(e);
        return jsonResponse({
            msg: e.message
        }, 500);
    }

});
