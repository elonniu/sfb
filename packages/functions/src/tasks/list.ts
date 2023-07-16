import AWS from "aws-sdk";
import {Table} from "sst/node/table";
import {bad, ok, Task} from "../common";

const TableName = Table.tasks.tableName;
const region = process.env.AWS_REGION || "";

export async function handler(task: Task, context: any) {

    const dynamodb = new AWS.DynamoDB.DocumentClient({region});

    try {
        const data = await dynamodb.scan({
            TableName
        }).promise();

        data.Items && data.Items.sort((a, b) => {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        return ok(data);
    } catch (e: any) {
        console.error(e);
        return bad(e, context);
    }

}
