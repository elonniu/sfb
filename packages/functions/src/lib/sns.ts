import AWS from "aws-sdk";

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
    let list = [];

    for (let i = 0; i < items.length; i++) {

        list.push({
            Id: `${items[i].taskId}-${i}`,
            Message: JSON.stringify({
                ...items[i],
            })
        });

    }

    await snsPut(TopicArn, list);
}
