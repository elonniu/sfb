import {HttpStatusCode} from "axios";
import {StartExecutionOutput} from "aws-sdk/clients/stepfunctions";

export interface Task {
    shouldEnd: boolean;
    report: boolean;
    taskName: string;
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
    states?: StartExecutionOutput[];
}


export function delay() {
    const ms = 1000 - new Date().getMilliseconds();
    console.log(`waiting for start, delay ${ms} milliseconds until the next second`);
    return new Promise(resolve => setTimeout(resolve, ms));
}
