import {HttpStatusCode} from "axios";
import {Arn} from "aws-sdk/clients/stepfunctions";

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
    regions: string[];
    taskId: string;
    taskType: string;
    url: string;
    method: string;
    qps?: number;
    n?: number;
    perStateMachineExecuted?: number,
    currentStateMachineExecutedLeft?: number,
    c?: number;
    taskClient?: number;
    timeout: number;
    successCode: HttpStatusCode;
    startTime: string;
    createdAt: string;
    endTime: string;
    states?: Execution[];
}

export function delay(ExecutionId: string, startSeconds: number) {
    // has already passed the start second
    if (new Date().getSeconds() !== startSeconds) {
        return;
    }

    const ms = 1000 - new Date().getMilliseconds();
    console.log(`ExecutionId ${ExecutionId} Moving ${startSeconds} to ${startSeconds + 1} seconds, waiting ${ms} milliseconds`);
    return new Promise(resolve => setTimeout(resolve, ms));
}
