import {ApiHandler} from "sst/node/api";
import {executionUrl, jsonResponse} from "sst-helper";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";

const dynamodb = new AWS.DynamoDB.DocumentClient();
const sf = new AWS.StepFunctions();
const aws_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    // get all items from the table
    const data = await dynamodb.scan({
        TableName: Table.tasks.tableName,
    }).promise();

    // desc by createdAt
    data.Items && data.Items.sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // get step functions Execution status
    for (let item of data.Items || []) {

        if (item.states) {
            for (let state of item.states) {
                if (state.executionArn) {
                    const execution = await sf.describeExecution({
                        executionArn: state.executionArn
                    }).promise();
                    state.status = execution.status;
                    state.executionUrl = executionUrl(state.executionArn, aws_region);
                }
            }
        }

    }

    return jsonResponse({
        ...data
    });

});
