import AWS from "aws-sdk";
import {StartExecutionInput, StartExecutionOutput} from "aws-sdk/clients/stepfunctions";

const stepFunctions = new AWS.StepFunctions();

export async function startExecutionBatch(items: StartExecutionInput[]) {

    let list: StartExecutionOutput[] = [];
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
            list = data;
            // console.log('batchWriteParallel succeed: ', data);
        })
        .catch((error) => {
            console.error('batchWriteParallel error: ', error);
        });

    return list;

}
