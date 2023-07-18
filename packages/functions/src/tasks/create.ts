import {checkStackInRegions, nanoid} from "sst-helper";
import {bad, ok, SST_APP, SST_STAGE, Task} from "../common";
import {HttpStatusCode} from "axios";
import process from "process";
import {InvokeCommand, LambdaClient} from "@aws-sdk/client-lambda";

const current_region = process.env.AWS_REGION || "";
const TASK_VERSION = process.env.TASK_VERSION || "";

export const StackName = `${SST_APP}-${SST_STAGE}`;

const {
    TASK_GENERATE_FUNCTION
} = process.env;

export async function handler(event: Task, context: any) {

    try {
        const task = await checkTask(event);
        await dispatchTask(task);
        return ok(task);
    } catch (e: any) {
        return bad(e, context);
    }

}

async function checkTask(task: Task) {

    task.version = TASK_VERSION;
    task.client = 1;
    task.envInitDuration = -1;
    task.latency = -1;

    if (task.report) {
        task.report = true;
    }

    if (!task.name) {
        throw new Error("name is empty");
    }

    if (task.name.length > 24) {
        throw new Error("name is too long");
    }

    if (!task.compute) {
        task.compute = "Fargate";
    }

    if (!["Lambda", "Fargate", "Batch"].includes(task.compute)) {
        throw new Error(`compute must be in ${["Lambda", "Fargate", "Batch"].join(',')}`);
    }

    if (!["API", "HTML"].includes(task.type)) {
        throw new Error(`type must be in ${["API", "HTML"].join(',')}`);
    }

    if (!task.type) {
        throw new Error("type is empty");
    }

    if (!task.url) {
        throw new Error("url is empty");
    }

    try {
        new URL(task.url);
    } catch (e) {
        throw new Error("url is invalid");
    }

    if (task.timeout === undefined) {
        task.timeout = 5000;
    } else {
        task.timeout = parseInt(task.timeout.toString());
        if (task.timeout < 100) {
            throw new Error("timeout must be greater than 100 ms");
        }
    }

    if (!task.method) {
        task.method = "GET";
    }

    if (!["GET", "POST"].includes(task.method)) {
        throw new Error(`method must be in ${["GET", "POST"].join(',')}`);
    }

    // n and qps can not be both empty
    if (task.n === undefined && task.qps === undefined) {
        throw new Error("n and qps can not be both empty");
    }

    // n and qps can not be both set
    if (task.n !== undefined && task.qps !== undefined) {
        throw new Error("n and qps can not be both set");
    }

    if (task.n !== undefined) {
        task.n = parseInt(task.n.toString());
        if (task.n <= 0) {
            throw new Error("n must be greater than 0");
        }
    }

    if (task.c === undefined) {
        task.c = 1;
    } else {
        task.c = parseInt(task.c.toString());
        if (task.c <= 0) {
            throw new Error("c must be greater than 0");
        }
    }

    if (task.n !== undefined && task.c > task.n) {
        throw new Error("c must be less than n");
    }

    if (task.n && task.c) {
        task.nPerClient = Math.ceil(task.n / task.c);
    }

    if (task.qps !== undefined) {
        task.qps = parseInt(task.qps.toString());
        if (task.qps <= 0) {
            throw new Error("qps must be greater than 0");
        }
    }

    if (task.delay !== undefined) {
        task.delay = parseInt(task.delay.toString());
        if (task.delay <= 1) {
            throw new Error("delay must be greater than 1 ms");
        }
    }

    if (task.successCode === undefined) {
        task.successCode = 200;
    } else {
        task.successCode = parseInt(task.successCode.toString());
        if (!Object.values(HttpStatusCode).includes(task.successCode)) {
            throw new Error(`successCode must be in [${Object.values(HttpStatusCode).join(',')}]`);
        }
    }

    // the startTime and endTime must be time string and greater than now
    const now = new Date().getTime();
    if (task.startTime) {
        // startTime must be greater than now - 1 hours
        if (now - 3600 * 1000 > new Date(task.startTime).getTime()) {
            throw new Error("startTime must be greater than now - 1 hours");
        }
        task.startTime = new Date(new Date(task.startTime).getTime()).toISOString();
    } else {
        if (task.delay) {
            task.startTime = new Date(new Date().getTime() + task.delay * 1000).toISOString();
        } else {
            task.startTime = new Date().toISOString();
        }
    }

    if (task.endTime) {
        if (now > new Date(task.endTime).getTime()) {
            throw new Error("endTime must be greater than now");
        }
        task.endTime = new Date(new Date(task.endTime).getTime()).toISOString();
    } else {
        task.endTime = new Date(new Date(task.startTime).getTime() + 600 * 1000).toISOString();
    }

    // endTime must be greater than startTime
    if (new Date(task.startTime).getTime() > new Date(task.endTime).getTime()) {
        throw new Error("endTime must be greater than startTime");
    }

    // endTime must be less than startTime + 48 hours
    if (new Date(task.startTime).getTime() + 3600 * 48 * 1000 < new Date(task.endTime).getTime()) {
        throw new Error("endTime must be less than startTime + 48 hours");
    }

    if (task.compute === "Batch" && task.c < 2) {
        throw new Error("Batch compute c must be greater than 1")
    }

    if (!task.regions) {
        task.regions = [current_region];
    } else {

        if (task.regions.length > 10) {
            throw new Error("regions must be less than 5");
        }

        await checkStackInRegions(StackName, task.regions, SST_APP);
    }

    task.taskId = nanoid(15);
    task.createdAt = new Date().toISOString();
    task.status = "Pending";

    const {
        c,
        compute,
        createdAt,
        endTime,
        method,
        n,
        nPerClient,
        region,
        regions,
        report,
        startTime,
        successCode,
        taskId,
        name,
        type,
        timeout,
        url,
        status,
        qps,
        version
    } = task;

    return {
        c,
        compute,
        createdAt,
        endTime,
        method,
        n,
        nPerClient,
        region,
        regions,
        report,
        startTime,
        successCode,
        taskId,
        name,
        type,
        timeout,
        url,
        status,
        qps,
        version
    } as Task;
}

async function dispatchTask(task: Task) {
    task.states = {};

    const promises = task.regions.map(async region => {
        const client = new LambdaClient({region});

        const command = new InvokeCommand({
            FunctionName: TASK_GENERATE_FUNCTION || "",
            Payload: Buffer.from(JSON.stringify(task)),
        });

        const response = await client.send(command);

        let payload;
        if (response.Payload) {
            payload = JSON.parse(new TextDecoder("utf-8").decode(response.Payload));
        }

        task.states[region] = payload;
    });

    await Promise.all(promises);
}
