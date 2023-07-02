import {DynamoDB} from "aws-sdk";

const dynamoDb = new DynamoDB.DocumentClient();

async function batchDeleteRegions(TableName: string, Key: object, region: string) {
    try {
        const ddb = await new DynamoDB.DocumentClient({region});
        await ddb.delete({TableName, Key}).promise()
    } catch (error: any) {

    }
}

export async function batchDelete(table: string, Key: object, regions: string[]) {
    if (regions) {
        let promises = [];
        for (let i = 0; i < regions.length; i++) {
            promises.push(batchDeleteRegions(table, Key, regions[i]));
        }
        await Promise.all(promises);
    }
}

async function batchGetRegions(TableName: string, Key: object, region: string) {
    try {
        const ddb = await new DynamoDB.DocumentClient({region});
        const {Item} = await ddb.get({TableName, Key}).promise()
        return Item;
    } catch (error: any) {
        return null;
    }
}

export async function batchGet(table: string, Key: object, regions: string[]) {
    if (regions) {
        let promises = [];
        for (let i = 0; i < regions.length; i++) {
            promises.push(batchGetRegions(table, Key, regions[i]));
        }
        const list = await Promise.all(promises);
        // only return items that are not undefined
        return list.filter((item) => item !== null);
    }

    return [];
}

async function ddbPut(table: string, items: object[]) {

    const groupSize = 25;

    const batchWriteParallel = async (items: object[]) => {
        const promises = [];
        for (let i = 0; i < items.length; i += groupSize) {
            promises.push(dynamoDb.batchWrite({
                RequestItems: {
                    [table]: items.slice(i, i + groupSize)
                },
            }).promise());
        }
        return Promise.all(promises);
    };

    await batchWriteParallel(items)
        .then((data) => {
            console.log('batchWriteParallel succeed: ', data);
        })
        .catch((error) => {
            console.error('batchWriteParallel error: ', error);
        });

}

export async function batchPut(table: string, items: object[]) {

    if (items.length === 0) {
        return;
    }

    let list = [];

    for (let i = 0; i < items.length; i++) {

        let Item = items[i];

        list.push({
            PutRequest: {
                Item
            }
        });
    }

    return await ddbPut(table, list);
}
