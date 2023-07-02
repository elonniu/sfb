import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import {Table} from "sst/node/table";
import AWS from "aws-sdk";

const dynamodb = new AWS.DynamoDB.DocumentClient();
const TableName = Table.ip.tableName;

export const handler = ApiHandler(async (_evt) => {

    const params = {
        TableName,
        Key: {
            ip: _evt.requestContext.http.sourceIp,
        },
        ExpressionAttributeNames: {
            '#count': 'count'
        },
        ExpressionAttributeValues: {
            ':inc': 1
        },
        UpdateExpression: 'ADD #count :inc',
        ReturnValues: 'UPDATED_NEW',
    };

    await dynamodb.update(params, function (err, data) {
        if (err) {
            console.error("Unable to update item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            // console.log("UpdateItem succeeded:", JSON.stringify(data, null, 2));
        }
    }).promise();

    return jsonResponse({msg: "ok"});

});
