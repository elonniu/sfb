import AWS from "aws-sdk";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";
import {Execution} from "../common";

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
