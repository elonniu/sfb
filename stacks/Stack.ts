import {Api, EventBus, Function, StackContext, Table, Topic} from "sst/constructs";
import {ddbUrl, lambdaUrl, sfUrl, stackUrl, topicUrl} from "sst-helper";
import {Choice, Condition, JsonPath, Pass, StateMachine, TaskInput} from 'aws-cdk-lib/aws-stepfunctions';
import {LambdaInvoke} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from "aws-cdk-lib/aws-events";

export function Stack({stack}: StackContext) {

    const taskTable = new Table(stack, "tasks", {
        fields: {
            taskId: "string",
        },
        primaryIndex: {partitionKey: "taskId"},
    });

    const logsTable = new Table(stack, "logs", {
        fields: {
            id: "string",
        },
        primaryIndex: {partitionKey: "id"},
    });

    const ipTable = new Table(stack, "ip", {
        fields: {
            ip: "string",
        },
        primaryIndex: {partitionKey: "ip"},
    });

    const apiFunction = new Function(stack, "apiFunction", {
        handler: "packages/functions/src/test/api.handler",
        bind: [logsTable, ipTable]
    });

    const requestDispatchFunction = new Function(stack, "requestDispatchFunction", {
        handler: "packages/functions/src/sf/requestDispatch.handler",
        memorySize: 9999,
    });

    const lambdaTask = new LambdaInvoke(stack, 'Invoke Dispatch Lambda', {
        lambdaFunction: requestDispatchFunction,
        payload: TaskInput.fromObject({
            ExecutionId: JsonPath.stringAt('$$.Execution.Id'),
            input: TaskInput.fromJsonPathAt('$.Payload'),
        }),
        resultPath: '$',
    });

    const checkDispatchShouldEnd = new Choice(stack, 'Check Dispatch Should End')
        .when(Condition.booleanEquals('$.Payload.shouldEnd', true), new Pass(stack, 'End Dispatch State'))
        .otherwise(lambdaTask);

    lambdaTask.next(checkDispatchShouldEnd);

    const dispatchStateMachine = new StateMachine(stack, 'DispatchStateMachine', {
        definition: checkDispatchShouldEnd,
        stateMachineName: `${stack.stackName}-DispatchStateMachine`,
    });

    const requesterFunction = new Function(stack, "requesterFunction", {
        handler: "packages/functions/src/eda/requester.handler",
        memorySize: 1024,
    });

    const topic = new Topic(stack, "Topic", {
        subscribers: {
            subscriber1: requesterFunction,
        },
    });

    const sfRequestFunction = new Function(stack, "SfRequestFunction", {
        handler: "packages/functions/src/sf/request.handler",
        memorySize: 4048,
        bind: [logsTable]
    });

    const requestLambdaTask = new LambdaInvoke(stack, 'Invoke Request Lambda', {
        lambdaFunction: sfRequestFunction,
        payload: TaskInput.fromObject({
            ExecutionId: JsonPath.stringAt('$$.Execution.Id'),
            input: TaskInput.fromJsonPathAt('$.Payload'),
        }),
        resultPath: '$',
    });

    const checkRequestShouldEnd = new Choice(stack, 'Check Request Should End')
        .when(Condition.booleanEquals('$.Payload.shouldEnd', true), new Pass(stack, 'End Request State'))
        .otherwise(requestLambdaTask);

    requestLambdaTask.next(checkRequestShouldEnd);

    const requestStateMachine = new StateMachine(stack, 'RequestStateMachine', {
        definition: checkRequestShouldEnd,
        stateMachineName: `${stack.stackName}-RequestStateMachine`,
    });

    const taskCreateFunction = new Function(stack, "taskCreateFunction", {
        handler: "packages/functions/src/tasks/create.handler",
        memorySize: 2048,
        permissions: ['states:StartExecution', 'dynamodb:PutItem'],
        bind: [taskTable],
        environment: {
            DISPATCH_SF_ARN: dispatchStateMachine.stateMachineArn,
            REQUEST_SF_ARN: requestStateMachine.stateMachineArn,
        }
    });

    const taskListFunction = new Function(stack, "taskListFunction", {
        handler: "packages/functions/src/tasks/list.handler",
        memorySize: 2048,
        bind: [taskTable]
    });

    const taskAbortFunction = new Function(stack, "taskAbortFunction", {
        handler: "packages/functions/src/tasks/abort.handler",
        memorySize: 2048,
        permissions: ['states:StopExecution'],
        bind: [taskTable]
    });

    const taskDeleteFunction = new Function(stack, "taskDeleteFunction", {
        handler: "packages/functions/src/tasks/delete.handler",
        memorySize: 2048,
        permissions: ['states:StopExecution'],
        bind: [taskTable]
    });

    const regionsFunction = new Function(stack, "regionsFunction", {
        handler: "packages/functions/src/tasks/regions.handler",
        memorySize: 2048,
        permissions: ['cloudformation:DescribeStacks', 'ec2:describeRegions']
    });

    const sfStatusChangeLambda = new Function(stack, "lambda", {
        handler: "packages/functions/src/eda/sfStatus.handler",
        bind: [taskTable]
    });

    new EventBus(stack, "Bus", {
        cdk: {
            eventBus: events.EventBus.fromEventBusName(stack, "ImportedBus", "default"),
        },
        rules: {
            myRule: {
                pattern: {
                    source: ["aws.states"],
                    detailType: ["Step Functions Execution Status Change"]
                },
                targets: {
                    myTarget1: sfStatusChangeLambda,
                },
            },
        },
    });

    requesterFunction.bind([logsTable, topic]);
    requestDispatchFunction.bind([topic]);

    const api = new Api(stack, "api", {
        routes: {
            "GET /regions": regionsFunction,
            "GET /tasks": taskListFunction,
            "POST /tasks": taskCreateFunction,
            "PUT /tasks/{id}/abort": taskAbortFunction,
            "DELETE /tasks/{id}": taskDeleteFunction,
            "GET /api": apiFunction,
        },
    });

    stack.addOutputs({
        ApiEndpoint: api.url,
        stack: stackUrl(stack.stackId, stack.region),
        taskTable: ddbUrl(taskTable.tableName, stack.region),
        logsTable: ddbUrl(logsTable.tableName, stack.region),
        ipTable: ddbUrl(ipTable.tableName, stack.region),
        topic: topicUrl(topic.topicArn, stack.region),
        stateMachine: sfUrl(dispatchStateMachine.stateMachineArn, stack.region),
        taskCreateFunction: lambdaUrl(taskCreateFunction.functionName, stack.region),
        requestDispatchFunction: lambdaUrl(requestDispatchFunction.functionName, stack.region),
        requesterFunction: lambdaUrl(requesterFunction.functionName, stack.region),
        apiFunction: lambdaUrl(apiFunction.functionName, stack.region),
        RequestStateMachine: sfUrl(requestStateMachine.stateMachineArn, stack.region),
        SfRequestFunction: lambdaUrl(sfRequestFunction.functionName, stack.region),
    });

    return {logsTable};
}
