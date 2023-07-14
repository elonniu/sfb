import AWS from "aws-sdk";
import {TerminateJobRequest} from "aws-sdk/clients/batch";

async function batchTerminateJobByRegion(jobId: string, region: string) {
    const params: TerminateJobRequest = {
        jobId,
        reason: "Terminate by user",
    };

    const client = new AWS.Batch({region});
    await client.terminateJob(params).promise();
}

export async function batchTerminateJobs(globalTasks: any[]) {

    let promises = [];

    for (let current of globalTasks) {

        if (current.compute !== "Batch") {
            continue;
        }

        if (current.states) {
            for (const key in current.states) {
                if (current.states.hasOwnProperty(key)) {
                    promises.push(batchTerminateJobByRegion(key, current.region));
                }
            }
        }

    }

    await Promise.all(promises);
}
