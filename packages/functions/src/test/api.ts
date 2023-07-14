import {ApiHandler} from "sst/node/api";
import {Table} from "sst/node/table";
import {jsonResponse} from "sst-helper";
import {dynamoDb} from "../lib/ddb";

const TableName = Table.ip.tableName;

export const handler = ApiHandler(async (_evt) => {

    const ip = _evt.requestContext.http.sourceIp;
    const now = new Date().toISOString();

    const params = {
        TableName,
        Key: {
            ip
        },
        ExpressionAttributeNames: {
            '#attr': 'tally',
            '#time': 'startAt'
        },
        ExpressionAttributeValues: {
            ':inc': 1,
            ':now': now
        },
        UpdateExpression: 'ADD #attr :inc SET #time = if_not_exists(#time, :now)',
        ReturnValues: 'UPDATED_NEW'
    };

    const data = await dynamoDb.update(params).promise();

    return jsonResponse({message: "ok", data});


});
