import console from "console";
import {delay, Task} from "../common";
import AWS from "aws-sdk";
import {snsBatch} from "../lib/sns";
import {Topic} from "sst/node/topic";
import process from "process";
import {StackName} from "../tasks/create";

export const checkStepFunctionsStep = 5;

const stepFunctions = new AWS.StepFunctions();
const cloudwatch = new AWS.CloudWatch();
const taskFunction = process.env.taskFunction || '';
const lambda = new AWS.Lambda();

export async function handler(event: any) {

    const {ExecutionId, input} = event;
    const task: Task = input.value;
    const invokeStart = new Date().toISOString();

    let checkStepFunctionsCounter = 0;

    while (true) {

        if (new Date().getTime() > new Date(invokeStart).getTime() + 898 * 1000) {
            return {...task, shouldEnd: false};
        }

        checkStepFunctionsCounter++;
        if (checkStepFunctionsCounter === checkStepFunctionsStep) {
            const start = new Date().toISOString();
            const res = await stepFunctions.describeExecution({executionArn: ExecutionId}).promise();
            const end = new Date().toISOString();
            if (res && res.status !== 'RUNNING') {
                console.log(`return because execution is ${res.status}, check latency: ${new Date(end).getTime() - new Date(start).getTime()} ms`);
                return {shouldEnd: true};
            }
            checkStepFunctionsCounter = 0;
        }

        const startSeconds = new Date().getSeconds();

        // now between startTime and endTime
        const now = new Date().getTime();
        if (now < new Date(task.startTime).getTime()) {
            await delay(startSeconds);
            continue;
        }

        if (now > new Date(task.endTime).getTime()) {
            return {shouldEnd: true};
        }

        if (task.n) {
            if (task.c == 1) {
                let list = [];
                for (let i = 0; i < task.n; i++) {
                    list.push({...task, n: 1, nPerClient: 1});
                }
                await sendToSns(ExecutionId, list);
                return {shouldEnd: true};
            }
            if (task.c > 1) {

                try {
                    await lambda.invoke({
                        FunctionName: taskFunction,
                        Payload: JSON.stringify({
                            Records: [
                                {
                                    SNS: {
                                        Message: JSON.stringify({...task, c: 1, n: 1, nPerClient: 1})
                                    }
                                }
                            ]
                        }),
                        InvocationType: 'RequestResponse'
                    }).promise();
                } catch (e) {
                    console.log(e);
                }

                if (task.nPerClient !== undefined) {
                    task.nPerClient--;
                    if (task.nPerClient === 0) {
                        return {shouldEnd: true};
                    }
                }

            }
        } else if (task.qps) {
            let list = [];
            for (let i = 0; i < task.qps; i++) {
                list.push({...task, qps: undefined, c: 1, n: 1, nPerClient: 1});
            }
            await sendToSns(ExecutionId, list);
            await delay(startSeconds);
        }

    }

}

export async function sendToSns(ExecutionId: string, tasks: Task[]) {
    const start = new Date().toISOString();
    await snsBatch(Topic.Topic.topicArn, tasks);
    const end = new Date().toISOString();

    if (tasks[0].report) {
        return;
    }

    const dispatchSnsLatencyMs = new Date(end).getTime() - new Date(start).getTime();

    const params = {
        MetricData: [
            {
                MetricName: 'dispatchSnsLatencyMs',
                Dimensions: [
                    {
                        Name: "TaskId",
                        Value: tasks[0].taskId
                    },
                ],
                Timestamp: new Date,
                Unit: 'Milliseconds',
                Value: dispatchSnsLatencyMs
            },
            {
                MetricName: 'dispatchSnsSize',
                Dimensions: [
                    {
                        Name: "TaskId",
                        Value: tasks[0].taskId
                    },
                ],
                Timestamp: new Date,
                Unit: 'Count',
                Value: tasks.length
            },
        ],
        Namespace: StackName
    };

    cloudwatch.putMetricData(params, function (err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            // console.log(data);
        }
    });
}
