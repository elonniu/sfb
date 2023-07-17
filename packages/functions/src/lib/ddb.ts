import {DynamoDB} from "aws-sdk";
import console from "console";

export const dynamoDb = new DynamoDB.DocumentClient();

async function batchDeleteRegions(TableName: string, Key: object, region: string) {
    try {
        const ddb = await new DynamoDB.DocumentClient({region});
        await ddb.delete({TableName, Key}).promise()
    } catch (error: any) {
        console.log(error);
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
    try {
        if (regions) {
            let promises = [];
            for (let i = 0; i < regions.length; i++) {
                promises.push(batchGetRegions(table, Key, regions[i]));
            }
            const list = await Promise.all(promises);

            return list.filter((item) => item !== null);
        }
    } catch (error: any) {
        console.log(error);
        return [];
    }

    return [];
}


