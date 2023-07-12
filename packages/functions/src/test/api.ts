import {ApiHandler} from "sst/node/api";
import {Table} from "sst/node/table";
import AWS from "aws-sdk";
import {jsonResponse} from "sst-helper";

const dynamodb = new AWS.DynamoDB.DocumentClient();
const TableName = Table.ip.tableName;

export const handler = ApiHandler(async (_evt) => {

    const ip = _evt.requestContext.http.sourceIp;

    const params = {
        TableName,
        Key: {
            ip
        },
        ExpressionAttributeNames: {
            '#attr': 'tally'
        },
        ExpressionAttributeValues: {
            ':inc': 1
        },
        UpdateExpression: 'ADD #attr :inc',
        ReturnValues: 'UPDATED_NEW'
    };

    const data = await dynamodb.update(params).promise();

    return jsonResponse({message: "ok", data});

    // try {
    //     const getParams = {
    //         TableName,
    //         Key: {
    //             ip,
    //         },
    //     };
    //
    //     const results = await dynamodb.get(getParams).promise();
    //
    //     let count = results.Item ? results.Item.tally : 0;
    //
    //     const putParams = {
    //         TableName,
    //         Key: {
    //             ip,
    //         },
    //         UpdateExpression: "SET tally = :count",
    //         ExpressionAttributeValues: {
    //             ":count": ++count,
    //         },
    //     };
    //     await dynamodb.update(putParams).promise();
    //
    //     return jsonResponse({
    //         count: count,
    //     });
    //
    // } catch (e) {
    //
    // }
    //
    // return jsonResponse({count: 0});


});
