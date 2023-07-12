import AWS from "aws-sdk";
import {RunInstancesRequest} from "aws-sdk/clients/ec2";

export async function batchStopEc2(InstanceIds: string[], region: string) {
    try {
        const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region});
        await ec2.terminateInstances({InstanceIds}).promise();
    } catch (error: any) {

    }
}

export async function runInstancesBatch(region: string, items: RunInstancesRequest[]) {

    const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region});

    let InstanceIds: string[] = [];

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
                        InstanceIds.push(instance.InstanceId);
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


export async function runInstances(region: string, item: RunInstancesRequest, MaxCount: number) {

    const runBatch = 20;

    let InstanceIds: string[] = [];

    if (MaxCount <= runBatch) {

        const runInstanceParams: RunInstancesRequest = {
            ...item,
            MaxCount: MaxCount,
        };

        InstanceIds = await runInstancesBatch(region, [runInstanceParams]);

    } else {

        let runInstanceParamsList: RunInstancesRequest[] = [];

        while (MaxCount > 0) {
            let subtracted = (MaxCount >= runBatch) ? runBatch : MaxCount;
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
