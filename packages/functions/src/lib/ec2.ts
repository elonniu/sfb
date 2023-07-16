import AWS from "aws-sdk";
import {RunInstancesRequest} from "aws-sdk/clients/ec2";
import {Task} from "../common";

async function batchStopEc2ByRegion(InstanceIds: string[], region: string) {
    const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region});
    await ec2.terminateInstances({InstanceIds}).promise();
}

export async function batchStopEc2s(globalTasks: any[]) {

    let promises = [];

    for (let current of globalTasks) {

        if (current.compute !== "EC2") {
            continue;
        }

        if (current.states) {

            let InstanceIds = [];
            for (const key in current.states) {
                if (current.states.hasOwnProperty(key)) {
                    InstanceIds.push(key);
                }
            }

            promises.push(batchStopEc2ByRegion(InstanceIds, current.region));
        }

    }

    await Promise.all(promises);
}

export async function runInstancesBatch(region: string, items: RunInstancesRequest[]) {

    const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region});

    let InstanceIds = {};

    const batchWriteParallel = async (items: RunInstancesRequest[]) => {
        const promises = [];
        for (let i = 0; i < items.length; i++) {
            promises.push(
                ec2.runInstances(items[i]).promise()
            );
        }

        return Promise.all(promises);
    };

    await batchWriteParallel(items)
        .then((data) => {
            data.forEach((item, index) => {

                item.Instances?.forEach((instance) => {
                    if (instance.InstanceId) {
                        InstanceIds[instance.InstanceId] = "WAITING";
                    }
                });

            });
            // console.log('batchWriteParallel succeed: ', data);
        })
        .catch((error) => {
            console.error('batchWriteParallel error: ', error);
            throw new Error(error.message);
        });

    return InstanceIds;
}


export async function runInstances(task: Task, region: string, item: RunInstancesRequest) {

    const batch = 20;

    let MaxCount = task.c;

    let InstanceIds = {};

    if (MaxCount <= batch) {

        const runInstanceParams: RunInstancesRequest = {
            ...item,
            MaxCount: MaxCount,
        };

        InstanceIds = await runInstancesBatch(region, [runInstanceParams]);

    } else {

        let runInstanceParamsList: RunInstancesRequest[] = [];

        while (MaxCount > 0) {
            let subtracted = (MaxCount >= batch) ? batch : MaxCount;
            runInstanceParamsList.push({
                ...item,
                MaxCount: subtracted,
            });
            MaxCount -= subtracted;
        }

        InstanceIds = await runInstancesBatch(region, runInstanceParamsList);

    }

    return InstanceIds;

}
