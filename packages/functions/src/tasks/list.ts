import {ApiHandler} from "sst/node/api";
import {jsonResponse, sfUrl} from "sst-helper";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";

const dynamodb = new AWS.DynamoDB.DocumentClient();
const sf = new AWS.StepFunctions();
const stateMachineArn = process.env.SF || "";
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
        if (item.executionArn) {
            const execution = await sf.describeExecution({
                executionArn: item.executionArn
            }).promise();
            item.status = execution.status;
            item.executionUrl = sfUrl(stateMachineArn, aws_region);
        }
    }

    return jsonResponse({
        ...data
    });

});
