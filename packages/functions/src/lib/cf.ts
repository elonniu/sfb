import AWS from "aws-sdk";

export const SST_STAGE = process.env.SST_STAGE || "";
export const SST_APP = process.env.SST_APP || "";
export const StackName = `${SST_STAGE}-${SST_APP}-Stack`;
export const CloudWatchNamespace = `${SST_STAGE}-${SST_APP}`;

export async function checkStackDeployment(regions: string[] = []) {
    const stacks = await getStackDeployments(regions);
    return stacks.map(stack => stack.region);
}

export async function getStackDeployments(regions: string[] = []) {
    if (regions.length === 0) {
        const describeRegions = await new AWS.EC2().describeRegions().promise();
        if (describeRegions && describeRegions.Regions) {
            regions.push(...describeRegions.Regions.map(region => region.RegionName || ""));
        }
    }
    const promises = regions.map(checkStackInRegion);
    const list = await Promise.all(promises);
    return list.filter(stack => stack !== null);
}

async function checkStackInRegion(region: string) {

    try {
        const cloudformation = new AWS.CloudFormation({region});
        const stacks = await cloudformation.describeStacks({StackName}).promise();
        let stack = stacks.Stacks?.[0];
        stack.region = region;
        return stack;
    } catch (error: any) {
        if (error.code === 'ValidationError' && error.message.includes('does not exist')) {
            return null;
        } else {
            console.error(error.message);
            return null;
        }
    }
}
