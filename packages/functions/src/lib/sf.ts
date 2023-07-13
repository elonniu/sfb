import AWS from "aws-sdk";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";
import {Execution} from "../common";

async function batchStopRegions(executionArn: string, region: string) {
    const stepFunctions = new AWS.StepFunctions({region});
    await stepFunctions.stopExecution({executionArn}).promise();
}

export async function batchStop(list: any[]) {
    let promises = [];
    for (let i = 0; i < list.length; i++) {
        const {executionArn, region} = list[i];
        promises.push(batchStopRegions(executionArn, region));
    }
    await Promise.all(promises);
}

export async function startExecutionBatch(region: string, items: StartExecutionInput[]) {

    const stepFunctions = new AWS.StepFunctions({region});

    let list: Execution[] = [];

    const batchWriteParallel = async (items: StartExecutionInput[]) => {
        const promises = [];
        for (let i = 0; i < items.length; i++) {
            promises.push(
                stepFunctions.startExecution({
                    stateMachineArn: items[i].stateMachineArn,
                    input: items[i].input,
                    name: items[i].name
                }).promise()
            );
        }

        return Promise.all(promises);
    };

    await batchWriteParallel(items)
        .then((data) => {
            data.forEach((item, index) => {
                list.push({
                    executionArn: item.executionArn,
                    status: "WAITING",
                    startDate: item.startDate.toISOString() || new Date().toISOString()
                });
            });
            // console.log('batchWriteParallel succeed: ', data);
        })
        .catch((error) => {
            console.error('batchWriteParallel error: ', error);
        });

    return list;

}
