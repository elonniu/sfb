import {DynamoDB} from "aws-sdk";

export const dynamoDb = new DynamoDB.DocumentClient();

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


