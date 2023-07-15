import AWS from "aws-sdk";
import {RunTaskRequest, StopTaskRequest} from "aws-sdk/clients/ecs";
import {Task} from "../common";

const CLUSTER_ARN = process.env.CLUSTER_ARN || "";

async function batchStopTaskByRegion(task: string, region: string) {
    const params: StopTaskRequest = {
        task,
        cluster: CLUSTER_ARN,
    };

    const client = new AWS.ECS({region});
    await client.stopTask(params).promise();
}

export async function batchStopTasks(globalTasks: any[]) {

    let promises = [];

    for (let current of globalTasks) {

        if (current.compute !== "Fargate") {
            continue;
        }

        if (current.states) {
            for (const key in current.states) {
                if (current.states.hasOwnProperty(key)) {
                    promises.push(batchStopTaskByRegion(key, current.region));
                }
            }
        }

    }

    await Promise.all(promises);
}

export async function runTasks(task: Task, region: string, item: RunTaskRequest) {

    const runInstanceBatch = 10;

    let MaxCount = task.c;

    let InstanceIds = {};

    if (MaxCount <= runInstanceBatch) {

        const runInstanceParams: RunTaskRequest = {
            ...item,
            count: MaxCount,
        };

        InstanceIds = await runTasksBatch(region, [runInstanceParams]);

    } else {

        let runInstanceParamsList: RunTaskRequest[] = [];

        while (MaxCount > 0) {
            let subtracted = (MaxCount >= runInstanceBatch) ? runInstanceBatch : MaxCount;
            runInstanceParamsList.push({
                ...item,
                count: subtracted,
            });
            MaxCount -= subtracted;
        }

        InstanceIds = await runTasksBatch(region, runInstanceParamsList);

    }

    return InstanceIds;

}

async function runTasksBatch(region: string, items: RunTaskRequest[]) {

    const ecs = new AWS.ECS({region});

    let InstanceIds = {};

    const batchWriteParallel = async (items: RunTaskRequest[]) => {
        const promises = [];
        for (let i = 0; i < items.length; i++) {
            promises.push(
                ecs.runTask(items[i]).promise()
            );
        }

        return Promise.all(promises);
    };

    await batchWriteParallel(items)
        .then((data) => {
            data.forEach((item, index) => {
                item.tasks?.forEach((task) => {
                    if (task.taskArn) {
                        InstanceIds[task.taskArn] = {
                            status: "WAITING"
                        };
                    }
                });
            });
        })
        .catch((error) => {
            console.error('batchWriteParallel error: ', error);
            throw new Error(error.message);
        });

    return InstanceIds;
}
