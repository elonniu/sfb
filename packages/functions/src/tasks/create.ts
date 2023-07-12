import {ApiHandler} from "sst/node/api";
import {executionUrl, jsonResponse} from "sst-helper";
import AWS, {EC2} from "aws-sdk";
import {StartExecutionInput} from "aws-sdk/clients/stepfunctions";
import {v4 as uuidv4} from "uuid";
import {StatesList, Task} from "../common";
import {HttpStatusCode} from "axios";
import {Table} from "sst/node/table";
import {startExecutionBatch} from "../lib/sf";
import {checkStackDeployment} from "../lib/cf";
import process from "process";

const {
    INSTANCE_PROFILE_NAME,
    BUCKET_NAME
} = process.env;

const dispatchStateMachineArn = process.env.DISPATCH_SF_ARN || "";
const requestStateMachineArn = process.env.REQUEST_SF_ARN || "";
const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    let task: Task = JSON.parse(_evt.body || "{}");

    if (task.report) {
        task.report = true;
    }

    if (!task.taskName) {
        return jsonResponse({msg: "taskName is empty"}, 400);
    }

    if (!task.compute) {
        return jsonResponse({msg: "compute is empty"}, 400);
    }

    if (task.compute !== "EC2" && task.compute !== "Lambda") {
        return jsonResponse({msg: "compute must be Lambda or EC2"}, 400);
    }

    if (!task.taskType) {
        return jsonResponse({msg: "taskType is empty"}, 400);
    }

    task.taskType = task.taskType.toUpperCase();

    if (!task.url || !task.timeout) {
        return jsonResponse({msg: "url, timeout is empty"}, 400);
    }

    // validate url
    try {
        new URL(task.url);
    } catch (e) {
        return jsonResponse({msg: "url is invalid"}, 400);
    }

    if (!task.method) {
        return jsonResponse({msg: "method is empty"}, 400);
    }
    task.method = task.method.toUpperCase();

    // n and qps can not be both empty
    if (task.n === undefined && task.qps === undefined) {
        return jsonResponse({msg: "n and qps can not be both empty"}, 400);
    }

    // n and qps can not be both set
    if (task.n !== undefined && task.qps !== undefined) {
        return jsonResponse({msg: "n and qps can not be both set"}, 400);
    }

    // n must be greater than 0 and be integer
    if (task.n !== undefined && (task.n <= 0 || !Number.isInteger(task.n))) {
        return jsonResponse({msg: "n must be greater than 0 and be integer"}, 400);
    }

    // c must be greater than 0 and be integer
    if (task.c !== undefined && (task.c <= 0 || !Number.isInteger(task.c))) {
        return jsonResponse({msg: "c must be greater than 0 and be integer"}, 400);
    }

    // c must be less than n
    if (task.c !== undefined && task.n !== undefined && task.c > task.n) {
        return jsonResponse({msg: "c must be less than n"}, 400);
    }

    // qps must be greater than 0 and be integer
    if (task.qps !== undefined && (task.qps <= 0 || !Number.isInteger(task.qps))) {
        return jsonResponse({msg: "qps must be greater than 0 and be integer"}, 400);
    }

    // delay must be greater than 0 and be integer
    if (task.delay !== undefined && (task.delay <= 0 || !Number.isInteger(task.delay))) {
        return jsonResponse({msg: "delay must be greater than 0 and be integer"}, 400);
    }

    if (task.timeout === undefined) {
        task.timeout = 1000;
    }

    // timeout must be greater than 0 and be integer
    if (task.timeout <= 0 || !Number.isInteger(task.timeout)) {
        return jsonResponse({msg: "timeout must be greater than 0 and be integer"}, 400);
    }

    if (!Object.values(HttpStatusCode).includes(task.successCode)) {
        return jsonResponse({msg: `successCode must be in [${Object.values(HttpStatusCode).join(',')}]`}, 400);
    }

    // the startTime and endTime must be time string and greater than now
    const now = new Date().getTime();
    if (task.startTime) {
        // startTime must be greater than now - 1 hours
        if (now - 3600 * 1000 > new Date(task.startTime).getTime()) {
            return jsonResponse({msg: "startTime must be greater than now - 1 hours"}, 400);
        }
        task.startTime = new Date(new Date(task.startTime).getTime()).toISOString();
    } else {
        task.startTime = new Date().toISOString();
    }

    if (task.endTime) {
        if (now > new Date(task.endTime).getTime()) {
            return jsonResponse({msg: "endTime must be greater than now"}, 400);
        }
        task.endTime = new Date(new Date(task.endTime).getTime()).toISOString();
    } else {
        task.endTime = new Date(new Date(task.startTime).getTime() + 600 * 1000).toISOString();
    }

    // endTime must be greater than startTime
    if (new Date(task.startTime).getTime() > new Date(task.endTime).getTime()) {
        return jsonResponse({msg: "endTime must be greater than startTime"}, 400);
    }

    // endTime must be less than startTime + 48 hours
    if (new Date(task.startTime).getTime() + 3600 * 48 * 1000 < new Date(task.endTime).getTime()) {
        return jsonResponse({msg: "endTime must be less than startTime + 48 hours"}, 400);
    }

    task.taskId = uuidv4().toString();

    if (!task.regions) {
        task.regions = [current_region];
    } else {
        const deployRegions = await checkStackDeployment(task.regions);
        // list task.regions are not in deployRegions
        const notDeployRegions = task.regions.filter((region) => !deployRegions.includes(region));
        if (notDeployRegions.length > 0) {
            return jsonResponse({
                msg: `ServerlessBench not in [${notDeployRegions.join(', ')}] yet, available regions [${deployRegions.join(', ')}]`
            }, 400);
        }
    }

    try {
        const start = Date.now();
        const states = task.compute === "Lambda" ? await dispatchRegionsLambda(task) : await dispatchRegionsEc2(task);
        const end = Date.now();

        return jsonResponse({
            latency: Number(end.toString()) - Number(start.toString()),
            ...task,
            states,
        });

    } catch (e: any) {
        return jsonResponse({msg: e.message}, 500);
    }

});

async function dispatchRegionsLambda(task: Task) {
    let statesList: StatesList = {};

    for (const region of task.regions) {

        task.region = region;

        let sfExe: StartExecutionInput[] = [];

        if (task.n && task.c) {
            for (let i = 0; i < task.c; i++) {
                const taskClient = i + 1;
                sfExe.push({
                    name: `request_${task.taskName}_${task.taskId}-${taskClient}`,
                    stateMachineArn: requestStateMachineArn.replace(current_region, region),
                    input: JSON.stringify({
                        Payload: {
                            ...task,
                            taskClient,
                            perStateMachineExecuted: Math.ceil(task.n / task.c),
                            currentStateMachineExecutedLeft: Math.ceil(task.n / task.c),
                            shouldEnd: false,
                        },
                    }),
                });
            }
        } else {
            sfExe.push({
                name: `${task.qps ? 'qps' : 'batch'}_${task.taskName}_${task.taskId}`,
                stateMachineArn: dispatchStateMachineArn.replace(current_region, region),
                input: JSON.stringify({
                    Payload: {
                        ...task,
                        taskClient: 0,
                        shouldEnd: false,
                    },
                }),
            });
        }
        const states = await startExecutionBatch(region, sfExe);

        const dynamodb = new AWS.DynamoDB.DocumentClient({region});
        await dynamodb.put({
            TableName: Table.tasks.tableName,
            Item: {
                ...task,
                states,
                createdAt: new Date().toISOString(),
            },
        } as AWS.DynamoDB.DocumentClient.PutItemInput).promise();

        states.forEach((state) => {
            state.executionUrl = executionUrl(state.executionArn, region);
        });

        statesList[region] = states;
    }

    return statesList;
}

async function dispatchRegionsEc2(task: Task) {

    let ec2Instances: any[] = [];

    for (const region of task.regions) {

        task.region = region;

        if (task.n && task.c) {
            ec2Instances = await createInstances(task, region, task.c);
        } else {
            ec2Instances = await createInstances(task, region);
        }

        const dynamodb = new AWS.DynamoDB.DocumentClient({region});
        await dynamodb.put({
            TableName: Table.tasks.tableName,
            Item: {
                ...task,
                ec2Instances,
                createdAt: new Date().toISOString(),
            },
        } as AWS.DynamoDB.DocumentClient.PutItemInput).promise();

    }

    return ec2Instances;
}

async function createInstances(task: Task, region: string, MaxCount: number = 1) {
    let request_count = task.n;

    if (task.qps) {
        request_count = task.qps;
    }

    if (task.n && task.c) {
        request_count = Math.ceil(task.n / task.c);
    }

    const start_time = Math.round(new Date(task.startTime).getTime() / 1000);
    const end_time = Math.round(new Date(task.endTime).getTime() / 1000);

    const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region});

    const qpsScript = `#!/bin/bash

url="${task.url}"
start_time=${start_time}
end_time=${end_time}
request_count=${request_count}
taskId=${task.taskId}
logfile=/tmp/log.${task.taskId}.txt
BUCKET_NAME=${BUCKET_NAME}
current_time=$(date +%s)

while (( current_time < start_time )); do
  sleep 1
  current_time=$(date +%s)
done

while (( current_time <= end_time )); do

  for (( i=0; i<request_count; i++ )); do
    (curl -o /dev/null -s $url -w "%{time_total}\n" >> $logfile) &
  done

  sleep 1

  current_time=$(date +%s)
done

aws s3 cp $logfile s3://$BUCKET_NAME/$logfile

TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -v http://169.254.169.254/latest/meta-data/instance-id)
aws ec2 terminate-instances --instance-ids $INSTANCE_ID
`;

    const batchscript = `#!/bin/bash

url="${task.url}"
start_time=${start_time}
end_time=${end_time}
request_count=${request_count}
taskId=${task.taskId}
logfile=/tmp/log.${task.taskId}.txt
BUCKET_NAME=${BUCKET_NAME}
current_time=$(date +%s)

while (( current_time < start_time )); do
  sleep 1
  current_time=$(date +%s)
done

for (( i=0; i<request_count; i++ )); do
  curl -o /dev/null -s $url -w "%{time_total}\\n" >> $logfile
done

aws s3 cp $logfile s3://$BUCKET_NAME/$logfile

TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -v http://169.254.169.254/latest/meta-data/instance-id)
aws ec2 terminate-instances --instance-ids $INSTANCE_ID
`;

    // cat /var/lib/cloud/instance/scripts/part-001
    // cat /tmp/log*
    // sudo cat /var/log/cloud-init-output.log

    const bootScript = task.qps ? qpsScript : batchscript;

    const runBatch = 20;

    let InstanceIds: string[] = [];

    if (MaxCount <= runBatch) {
        const runInstanceParams: EC2.Types.RunInstancesRequest = {
            ImageId: 'ami-0b94777c7d8bfe7e3',
            InstanceType: 't2.micro',
            MinCount: 1,
            MaxCount: MaxCount,
            KeyName: 'mac',
            UserData: Buffer.from(bootScript).toString('base64'),
            IamInstanceProfile: {
                Name: INSTANCE_PROFILE_NAME,
            }
        };

        const result = await ec2.runInstances(runInstanceParams).promise();
        result.Instances?.forEach((instance) => {
            if (instance.InstanceId) {
                InstanceIds.push(instance.InstanceId);
            }
        });


    } else {

        while (MaxCount > 0) {
            let subtracted = (MaxCount >= runBatch) ? runBatch : MaxCount;

            const runInstanceParams: EC2.Types.RunInstancesRequest = {
                ImageId: 'ami-0b94777c7d8bfe7e3',
                InstanceType: 't2.micro',
                MinCount: 1,
                MaxCount: subtracted,
                KeyName: 'mac',
                UserData: Buffer.from(bootScript).toString('base64'),
                IamInstanceProfile: {
                    Name: INSTANCE_PROFILE_NAME,
                }
            };

            const result = await ec2.runInstances(runInstanceParams).promise();
            result.Instances?.forEach((instance) => {
                if (instance.InstanceId) {
                    InstanceIds.push(instance.InstanceId);
                }
            });

            MaxCount -= subtracted;
        }


    }

    return InstanceIds;

}
