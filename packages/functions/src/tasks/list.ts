import {sortKeys} from "sst-helper";
import AWS from "aws-sdk";
import {Table} from "sst/node/table";
import {Task} from "../common";

const TableName = Table.tasks.tableName;
const region = process.env.AWS_REGION || "";

export async function handler(task: Task) {

    const dynamodb = new AWS.DynamoDB.DocumentClient({region});

    try {
        const data = await dynamodb.scan({
            TableName
        }).promise();

        // desc by createdAt
        data.Items && data.Items.sort((a, b) => {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        // data.Items && data.Items.forEach((item: any) => {
        //     item.status = "SUCCEEDED";
        //     item.states && item.states.forEach((state: any) => {
        //         if (state.status === "WAITING") {
        //             item.status = "WAITING";
        //         }
        //         if (state.status === "RUNNING") {
        //             item.status = "RUNNING";
        //         }
        //     });
        // });

        return sortKeys({
            ...data
        });
    } catch (e: any) {
        console.error(e);
        return sortKeys({
            msg: e.message
        }, 500);
    }

}
