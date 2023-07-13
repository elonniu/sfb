import AWS from "aws-sdk";
import {RunInstancesRequest} from "aws-sdk/clients/ec2";
import {Task} from "../common";

export async function batchStopEc2(task: any) {
    const {ec2Instances, region} = task;
    if (!ec2Instances) {
        return;
    }
    const InstanceIds = Object.keys(ec2Instances);
    const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region});
    await ec2.terminateInstances({InstanceIds}).promise();
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
        });

    return InstanceIds;
}


export async function runInstances(task: Task, region: string, item: RunInstancesRequest, MaxCount: number) {

    if (!task.runInstanceBatch) {
        task.runInstanceBatch = 20;
    }

    let InstanceIds = {};

    if (MaxCount <= task.runInstanceBatch) {

        const runInstanceParams: RunInstancesRequest = {
            ...item,
            MaxCount: MaxCount,
        };

        InstanceIds = await runInstancesBatch(region, [runInstanceParams]);

    } else {

        let runInstanceParamsList: RunInstancesRequest[] = [];

        while (MaxCount > 0) {
            let subtracted = (MaxCount >= task.runInstanceBatch) ? task.runInstanceBatch : MaxCount;
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
