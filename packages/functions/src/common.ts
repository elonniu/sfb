import {HttpStatusCode} from "axios";
import {Arn} from "aws-sdk/clients/stepfunctions";

export interface StatesList {
    [key: string]: Execution[];
}

export interface Execution {
    executionArn: Arn;
    startDate: string;
    status?: string;
    executionUrl?: string;
}

export interface Task {
    shouldEnd: boolean;
    report: boolean;
    taskName: string;
    taskId: string;
    taskType: string;
    taskClient?: number;
    taskStep?: number;
    url: string;
    method: "GET" | "POST" | "PUT" | string;
    compute: "Lambda" | "EC2" | string;
    KeyName?: string;
    InstanceType?: string;
    qps?: number;
    n?: number;
    c?: number;
    taskDelaySeconds?: number;
    regions: string[];
    region: string;
    perStateMachineExecuted?: number,
    currentStateMachineExecutedLeft?: number,
    delay?: number;
    timeout: number;
    successCode: HttpStatusCode;
    startTime: string;
    createdAt: string;
    endTime: string;
    states?: Execution[];
}

export function delay(startSeconds: number) {
    // has already passed the start second
    if (new Date().getSeconds() !== startSeconds) {
        return;
    }

    const waitingMs = 1000 - new Date().getMilliseconds();
    console.log(JSON.stringify({
        from: startSeconds,
        to: startSeconds + 1,
        waitingMs,
    }));
    return new Promise(resolve => setTimeout(resolve, waitingMs));
}
