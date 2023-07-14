import {Task} from "../common";
import {Table} from "sst/node/table";
import {dynamoDb} from "../lib/ddb";

export async function handler(event: any) {

    const {detail: {taskArn, overrides, lastStatus}} = event;

    if (overrides.containerOverrides) {
        for (const containerOverride of overrides.containerOverrides) {
            const {environment} = containerOverride;
            for (const env of environment) {
                if (env.name === "TASK") {
                    const task = JSON.parse(env.value) as Task;

                    await updateStateStatus(task.taskId, taskArn, lastStatus);

                }
            }
        }
    }

    return {};
}

export async function updateStateStatus(taskId: string, arn: string, status: string) {
    const params = {
        TableName: Table.tasks.tableName,
        Key: {
            taskId
        },
        ExpressionAttributeNames: {
            '#jsonField': 'states',
            '#instanceId': arn
        },
        ExpressionAttributeValues: {
            ':newValue': status
        },
        UpdateExpression: 'SET #jsonField.#instanceId = :newValue',
        ReturnValues: 'UPDATED_NEW'
    };

    await dynamoDb.update(params).promise();
}
