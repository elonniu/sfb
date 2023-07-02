import AWS from "aws-sdk";
import {Region} from "aws-sdk/clients/ec2";

export const SST_STAGE = process.env.SST_STAGE || "";
export const SST_APP = process.env.SST_APP || "";
export const StackName = `${SST_STAGE}-${SST_APP}-Stack`;

async function checkStackInRegion(region: Region) {

    const RegionName: string = region.RegionName || "";

    try {
        const cloudformation = new AWS.CloudFormation({region: RegionName});
        await cloudformation.describeStacks({StackName}).promise();
        return {RegionName, Deployed: true};
    } catch (error: any) {
        if (error.code === 'ValidationError' && error.message.includes('does not exist')) {
            return {RegionName, Deployed: false};
        } else {
            return {RegionName, Deployed: false, Error: `Error: ${error.message}`};
        }
    }
}

export async function checkStackDeployment() {
    const regions = await new AWS.EC2().describeRegions().promise();
    if (regions && regions.Regions) {
        const promises = regions.Regions.map(checkStackInRegion);
        const list = await Promise.all(promises);
        return list.filter(region => region.Deployed);
    }

    return [];
}
