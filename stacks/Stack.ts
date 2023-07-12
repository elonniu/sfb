import {Api, Bucket, EventBus, Function, StackContext, Table, Topic} from "sst/constructs";
import {bucketUrl, ddbUrl, lambdaUrl, sfUrl, stackUrl, topicUrl} from "sst-helper";
import {Choice, Condition, JsonPath, Pass, StateMachine, TaskInput} from 'aws-cdk-lib/aws-stepfunctions';
import {LambdaInvoke} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from "aws-cdk-lib/aws-events";
import {CfnInstanceProfile, ManagedPolicy, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";

export function Stack({stack}: StackContext) {

    const ec2Role = new Role(stack, "ec2Role", {
        assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
        managedPolicies: [
            ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
            ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2FullAccess"),
        ]
    });

    const ec2InstanceProfile = new CfnInstanceProfile(stack, "ec2InstanceProfile", {
        roles: [ec2Role.roleName],
        instanceProfileName: "ec2InstanceProfile"
    });

    const taskTable = new Table(stack, "tasks", {
        fields: {
            taskId: "string",
        },
        primaryIndex: {partitionKey: "taskId"},
    });

    const bucket = new Bucket(stack, "bucket");

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
        permissions: ['states:DescribeExecution', 'cloudwatch:PutMetricData']
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
        permissions: ['states:DescribeExecution', 'cloudwatch:PutMetricData'],
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

    const taskGetFunction = new Function(stack, "taskGetFunction", {
        handler: "packages/functions/src/tasks/get.handler",
        permissions: ['dynamodb:GetItem'],
        memorySize: 2048,
        bind: [taskTable],
    });

    const taskCreateFunction = new Function(stack, "taskCreateFunction", {
        handler: "packages/functions/src/tasks/create.handler",
        permissions: [
            'states:StartExecution', 'dynamodb:PutItem', 'ec2:describeRegions', 'cloudformation:DescribeStacks',
            'ec2:*',
            'iam:*'
        ],
        memorySize: 2048,
        bind: [taskTable],
        environment: {
            DISPATCH_SF_ARN: dispatchStateMachine.stateMachineArn,
            REQUEST_SF_ARN: requestStateMachine.stateMachineArn,
            INSTANCE_PROFILE_NAME: ec2InstanceProfile.instanceProfileName || "",
            BUCKET_NAME: bucket.bucketName,
        },
    });

    const taskListFunction = new Function(stack, "taskListFunction", {
        handler: "packages/functions/src/tasks/list.handler",
        permissions: ['dynamodb:Scan'],
        memorySize: 2048,
        bind: [taskTable]
    });

    const taskAbortFunction = new Function(stack, "taskAbortFunction", {
        handler: "packages/functions/src/tasks/abort.handler",
        permissions: ['states:StopExecution', 'dynamodb:GetItem', 'dynamodb:UpdateItem'],
        memorySize: 2048,
        bind: [taskTable]
    });

    const taskDeleteFunction = new Function(stack, "taskDeleteFunction", {
        handler: "packages/functions/src/tasks/delete.handler",
        permissions: ['states:StopExecution', 'dynamodb:GetItem', 'dynamodb:DeleteItem'],
        memorySize: 2048,
        bind: [taskTable]
    });

    const regionsFunction = new Function(stack, "regionsFunction", {
        handler: "packages/functions/src/tasks/regions.handler",
        permissions: ['ec2:describeRegions', 'cloudformation:DescribeStacks'],
        memorySize: 2048,
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
            "GET /tasks/{id}": taskGetFunction,
            "DELETE /tasks/{id}": taskDeleteFunction,
            "PUT /tasks/{id}/abort": taskAbortFunction,
            "GET /api": apiFunction,
        },
    });

    stack.addOutputs({
        ApiEndpoint: api.url,
        stack: stackUrl(stack.stackId, stack.region),
        taskTable: ddbUrl(taskTable.tableName, stack.region),
        bucket: bucketUrl(bucket.bucketName, stack.region),
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
        taskDeleteFunction: lambdaUrl(taskDeleteFunction.functionName, stack.region),
    });

    return {logsTable};
}
