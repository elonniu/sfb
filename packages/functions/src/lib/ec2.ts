import AWS from "aws-sdk";

export async function batchStopEc2(InstanceIds: string[], region: string) {
    try {
        const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region});
        await ec2.terminateInstances({InstanceIds}).promise();
    } catch (error: any) {

    }
}
