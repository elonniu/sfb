import AWS from "aws-sdk";
import {dynamoDb} from "../lib/ddb";
import {Table} from "sst/node/table";

const ec2 = new AWS.EC2({apiVersion: '2016-11-15'});

export async function handler(event: any) {
    const {detail} = event;

    if (detail.state === "pending") {

    }

    // get TagSpecifications from ec2 instance
    const {Tags} = await ec2.describeTags({
        Filters: [
            {
                Name: "resource-id",
                Values: [detail["instance-id"]]

            }
        ]
    }).promise();

    if (Tags) {

        for (const tag of Tags) {
            if (tag.Key === "TaskId") {
                const taskId = tag.Value;

                const params = {
                    TableName: Table.tasks.tableName,
                    Key: {
                        taskId
                    },
                    ExpressionAttributeNames: {
                        '#jsonField': 'ec2Instances',
                        '#instanceId': detail["instance-id"]
                    },
                    ExpressionAttributeValues: {
                        ':newValue': detail.state
                    },
                    UpdateExpression: 'SET #jsonField.#instanceId = :newValue',
                    ReturnValues: 'UPDATED_NEW'
                };

                dynamoDb.update(params, function (err, data) {
                    if (err) {
                        console.error("Error", err);
                    } else {
                        console.log("Success", data);
                    }
                });

            }
        }

    }

    return {};
}


