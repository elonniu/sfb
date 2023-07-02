import AWS from "aws-sdk";
import {v4 as uuidv4} from "uuid";

const sqs = new AWS.SQS();

export function sqsPut(QueueUrl: string, items: object[]) {

    const groupSize = 10;

    const batchWriteParallel = async (items: object[]) => {
        const promises = [];
        for (let i = 0; i < items.length; i += groupSize) {
            promises.push(
                sqs.sendMessageBatch({
                    QueueUrl,
                    Entries: items.slice(i, i + groupSize),
                }).promise()
            );
        }
        return Promise.all(promises);
    };

    batchWriteParallel(items)
        .then((data) => {
            // console.log('batchWriteParallel succeed: ', data);
        })
        .catch((error) => {
            console.error('batchWriteParallel error: ', error);
        });

}

export async function sqsBatch(sqsArn: string, items: object[]) {
    let sqsMessages = [];

    const taskId = uuidv4().toString();

    for (let i = 0; i < items.length; i++) {

        sqsMessages.push({
            Id: `${taskId}-${i}`,
            MessageBody: JSON.stringify({
                ...items[i],
                taskId
            })
        });

    }

    await sqsPut(sqsArn, sqsMessages);
}
