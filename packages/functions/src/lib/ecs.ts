import AWS from "aws-sdk";
import {RunTaskRequest, StopTaskRequest} from "aws-sdk/clients/ecs";
import {Task} from "../common";
import console from "console";

async function batchStopTaskByRegion(taskArn: string, task: Task) {
    try {
        const params: StopTaskRequest = {
            task: taskArn,
            cluster: task.cluster,
        };

        const client = new AWS.ECS({region: task.region});
        await client.stopTask(params).promise();
    } catch (e: any) {
        console.log({taskArn, region: task.region, cluster: task.cluster});
        console.error("batchStopTaskByRegion error: ", e.message);
    }
}

export async function batchStopTasks(globalTasks: any[]) {

    let promises = [];

    for (let task of globalTasks) {

        if (task.compute !== "Fargate") {
            continue;
        }

        if (task.states) {
            for (const key in task.states) {
                if (task.states.hasOwnProperty(key)) {
                    promises.push(batchStopTaskByRegion(key, task));
                }
            }
        }

    }

    await Promise.all(promises);
}

export async function runTasks(task: Task, region: string, item: RunTaskRequest) {

    const batch = 10;

    let count = task.c;

    let InstanceIds = {};

    if (count <= batch) {

        const runInstanceParams: RunTaskRequest = {
            ...item,
            count: count,
        };

        InstanceIds = await runTasksBatch(region, [runInstanceParams]);

    } else {

        let runInstanceParamsList: RunTaskRequest[] = [];

        while (count > 0) {
            let subtracted = (count >= batch) ? batch : count;
            runInstanceParamsList.push({
                ...item,
                count: subtracted,
            });
            count -= subtracted;
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
                        InstanceIds[task.taskArn] = "WAITING";
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
