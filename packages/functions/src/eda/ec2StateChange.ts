import AWS from "aws-sdk";
import {updateTaskState} from "../common";

const ec2 = new AWS.EC2({apiVersion: '2016-11-15'});

export async function handler(event: any) {

    const {detail} = event;

    const {Tags} = await ec2.describeTags({
        Filters: [
            {
                Name: "resource-id",
                Values: [detail["instance-id"]]

            }
        ]
    }).promise();

    if (Tags) {

        for (const tag of Tags) {
            if (tag.Key === "TaskId") {
                const taskId = tag.Value || "";
                await updateTaskState(taskId, detail["instance-id"], detail.state);
            }
        }

    }

    return {};
}
