import AWS from "aws-sdk";
import {v4 as uuidv4} from "uuid";

const sns = new AWS.SNS();

async function snsPut(TopicArn: string, items: object[]) {

    const groupSize = 10;

    const batchWriteParallel = async (items: object[]) => {
        const promises = [];
        for (let i = 0; i < items.length; i += groupSize) {
            let PublishBatchRequestEntries = items.slice(i, i + groupSize);
            promises.push(
                sns.publishBatch({TopicArn, PublishBatchRequestEntries}).promise()
            );
        }
        return Promise.all(promises);
    };

    await batchWriteParallel(items)
        .then((data) => {
            // console.log('batchWriteParallel succeed: ', data);
        })
        .catch((error) => {
            console.error('batchWriteParallel error: ', error);
        });

}

export async function snsBatch(TopicArn: string, items: object[]) {
    let sqsMessages = [];

    const taskId = uuidv4().toString();

    for (let i = 0; i < items.length; i++) {

        sqsMessages.push({
            Id: `${taskId}-${i}`,
            Message: JSON.stringify({
                ...items[i],
                taskId
            })
        });

    }

    await snsPut(TopicArn, sqsMessages);
}
