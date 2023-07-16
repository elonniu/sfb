import AWS from "aws-sdk";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";

async function batchStopExecutionsByRegion(executionArn: string, region: string) {
    const stepFunctions = new AWS.StepFunctions({region});
    await stepFunctions.stopExecution({executionArn}).promise();
}

export async function batchStopExecutions(globalTasks: any[]) {


    let listStop = [];

    for (let current of globalTasks) {

        if (current.compute !== "Lambda") {
            continue;
        }

        if (current && current.states) {

            for (const key in current.states) {
                if (current.states.hasOwnProperty(key)) {
                    listStop.push({
                        region: current.region,
                        executionArn: key
                    });
                }
            }

        }

    }

    let promises = [];
    for (let i = 0; i < listStop.length; i++) {
        const {executionArn, region} = listStop[i];
        promises.push(batchStopExecutionsByRegion(executionArn, region));
    }
    await Promise.all(promises);
}

export async function startExecutionBatch(region: string, items: StartExecutionInput[]) {

    const stepFunctions = new AWS.StepFunctions({region});

    let list = {};

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
                list[item.executionArn] = "WAITING";
            });
        })
        .catch((error) => {
            console.error('batchWriteParallel error: ', error);
            throw new Error(error.message);
        });

    return list;

}
