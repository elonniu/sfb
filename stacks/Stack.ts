import {Api, Function, StackContext, Table, Topic} from "sst/constructs";
import {ddbUrl, lambdaUrl, sfUrl, topicUrl} from "sst-helper";
import {Choice, Condition, Pass, StateMachine} from 'aws-cdk-lib/aws-stepfunctions';
import {LambdaInvoke} from 'aws-cdk-lib/aws-stepfunctions-tasks';

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

    const apiFunction = new Function(stack, "apiFunction", {
        handler: "packages/functions/src/api.handler",
    });

    const requestDispatchFunction = new Function(stack, "requestDispatchFunction", {
        handler: "packages/functions/src/requestDispatch.handler",
        memorySize: 9999,
    });

    const lambdaTask = new LambdaInvoke(stack, 'InvokeLambda', {
        lambdaFunction: requestDispatchFunction,
    });

    // 创建选择状态，根据 Lambda 函数的返回值决定是否结束状态机
    const checkShouldEnd = new Choice(stack, 'Check Should End')
        .when(Condition.booleanEquals('$.Payload.shouldEnd', true), new Pass(stack, 'End State'))
        .otherwise(lambdaTask);

    // 将调用 Lambda 函数的任务连接到选择状态
    lambdaTask.next(checkShouldEnd);

    // 定义状态机的初始状态为 Lambda 任务
    const stateMachine = new StateMachine(stack, 'StateMachine', {
        definition: checkShouldEnd,
        stateMachineName: `${stack.stackName}-StateMachine`,
    });

    const requesterFunction = new Function(stack, "requesterFunction", {
        handler: "packages/functions/src/requester.handler",
        memorySize: 1024,
    });

    const topic = new Topic(stack, "Topic", {
        subscribers: {
            subscriber1: requesterFunction,
        },
    });

    const taskCreateFunction = new Function(stack, "taskCreateFunction", {
        handler: "packages/functions/src/tasks/create.handler",
        memorySize: 2048,
        permissions: ['states:StartExecution'],
        bind: [taskTable],
        environment: {
            SF: stateMachine.stateMachineArn,
        }
    });

    const taskListFunction = new Function(stack, "taskListFunction", {
        handler: "packages/functions/src/tasks/list.handler",
        memorySize: 2048,
        permissions: ['states:DescribeExecution'],
        bind: [taskTable],
        environment: {
            SF: stateMachine.stateMachineArn,
        }
    });

    apiFunction.bind([logsTable]);
    requesterFunction.bind([logsTable, topic]);
    requestDispatchFunction.bind([topic]);

    const api = new Api(stack, "api", {
        routes: {
            "GET /tasks": taskListFunction,
            "POST /tasks": taskCreateFunction,
            "GET /api": apiFunction,
        },
    });

    stack.addOutputs({
        ApiEndpoint: api.url,
        taskTable: ddbUrl(taskTable.tableName, stack.region),
        logsTable: ddbUrl(logsTable.tableName, stack.region),
        topic: topicUrl(topic.topicArn, stack.region),
        stateMachine: sfUrl(stateMachine.stateMachineArn, stack.region),
        taskCreateFunction: lambdaUrl(taskCreateFunction.functionName, stack.region),
        requestDispatchFunction: lambdaUrl(requestDispatchFunction.functionName, stack.region),
        requesterFunction: lambdaUrl(requesterFunction.functionName, stack.region),
        apiFunction: lambdaUrl(apiFunction.functionName, stack.region),
    });
}
