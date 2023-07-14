import {Api, Bucket, EventBus, Function, StackContext, Table, Topic} from "sst/constructs";
import {bucketUrl, ddbUrl, lambdaUrl, sfUrl, stackUrl, topicUrl} from "sst-helper";
import {Choice, Condition, JsonPath, Pass, StateMachine, TaskInput} from 'aws-cdk-lib/aws-stepfunctions';
import {LambdaInvoke} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from "aws-cdk-lib/aws-events";
import {CfnInstanceProfile, ManagedPolicy, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {SecurityGroup, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import * as batch from "aws-cdk-lib/aws-batch";
import {Cluster, Compatibility, ContainerImage, LogDrivers, NetworkMode, TaskDefinition} from "aws-cdk-lib/aws-ecs";

export function Stack({stack}: StackContext) {

    const vpc = new Vpc(stack, "vpc", {
        maxAzs: 2,
        natGateways: 1,
        subnetConfiguration: [
            {
                name: "bench-public",
                subnetType: SubnetType.PUBLIC,
            },
        ]
    });

    const vpcSubnets = vpc.publicSubnets.map(subnet => subnet.subnetId);

    const securityGroup = new SecurityGroup(stack, "securityGroup", {
        securityGroupName: `${stack.stackName}-securityGroup`,
        vpc,
        allowAllOutbound: true,
    });

    const ecsCluster = new Cluster(stack, "cluster", {
        vpc,
        clusterName: `${stack.stackName}-cluster`,
        containerInsights: true,
    });

    const ecsTaskExecutionRole = new Role(stack, "ecsTaskExecutionRole", {
        roleName: `${stack.stackName}-ecsTaskExecutionRole`,
        assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
        managedPolicies: [
            ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
        ]
    });

    const ecsTaskDefinition = new TaskDefinition(stack, "ecsTaskDefinition", {
        family: `${stack.stackName}-ecsTaskDefinition`,
        networkMode: NetworkMode.AWS_VPC,
        taskRole: ecsTaskExecutionRole,
        executionRole: ecsTaskExecutionRole,
        cpu: "1024",
        memoryMiB: "2048",
        compatibility: Compatibility.FARGATE,
    });

    const container = ecsTaskDefinition.addContainer('TaskContainer', {
        image: ContainerImage.fromRegistry("public.ecr.aws/elonniu/serverless-bench:latest"),
        logging: LogDrivers.awsLogs({streamPrefix: 'TaskLogs'}),
    });

    const batchRole = new Role(stack, 'batchRole', {
        roleName: `${stack.stackName}-batchRole`,
        assumedBy: new ServicePrincipal('batch.amazonaws.com'),
    });

    batchRole.addToPolicy(new PolicyStatement({
        actions: ['logs:DescribeLogGroups', 'ecs:ListClusters', 'logs:CreateLogGroup'],
        resources: ['*'],
    }));

    const batchComputeEnvironment = new batch.CfnComputeEnvironment(stack, 'computeEnvironment', {
        computeEnvironmentName: `${stack.stackName}-compute-environment`,
        type: 'MANAGED',
        computeResources: {
            type: 'FARGATE',
            maxvCpus: 2,
            securityGroupIds: [securityGroup.securityGroupId],
            subnets: vpcSubnets,
        },
    });

    const jobQueue = new batch.CfnJobQueue(stack, 'JobQueue', {
        jobQueueName: `${stack.stackName}-job-queue`,
        computeEnvironmentOrder: [{
            computeEnvironment: batchComputeEnvironment.ref,
            order: 1,
        }],
        priority: 1,
        state: 'ENABLED',
    });

    const jobDefinition = new batch.CfnJobDefinition(stack, 'JobDefinition', {
        jobDefinitionName: `${stack.stackName}-job-definition`,
        type: 'container',
        platformCapabilities: ['FARGATE'],
        containerProperties: {
            image: "public.ecr.aws/elonniu/serverless-bench:latest",
            resourceRequirements: [
                {type: 'MEMORY', value: '2048'},  // value is in MiB
                {type: 'VCPU', value: '1'}
            ],
            executionRoleArn: ecsTaskExecutionRole.roleArn,
            networkConfiguration: {
                assignPublicIp: 'ENABLED',
            },
            logConfiguration: { // Set log configuration
                logDriver: 'awslogs',
                options: {
                    'awslogs-group': '/aws/batch/job',
                    'awslogs-region': stack.region,
                    'awslogs-stream-prefix': 'bench-job-definition'
                }
            }
        },
    });

    const ec2Role = new Role(stack, "ec2Role", {
        roleName: `${stack.stackName}-ec2Role`,
        assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
        managedPolicies: [
            ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
            ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2FullAccess"),
        ]
    });

    const ec2InstanceProfile = new CfnInstanceProfile(stack, "ec2InstanceProfile", {
        roles: [ec2Role.roleName],
        instanceProfileName: `${stack.stackName}-ec2InstanceProfile`
    });

    const bucket = new Bucket(stack, "bucket", {});

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
        functionName: `${stack.stackName}-apiFunction`,
        handler: "packages/functions/src/test/api.handler",
        bind: [logsTable, ipTable]
    });

    const requestDispatchFunction = new Function(stack, "requestDispatchFunction", {
        functionName: `${stack.stackName}-requestDispatchFunction`,
        handler: "packages/functions/src/sf/requestDispatch.handler",
        permissions: ['states:DescribeExecution', 'cloudwatch:PutMetricData'],
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
        stateMachineName: `${stack.stackName}-DispatchStateMachine`,
        definition: checkDispatchShouldEnd,
    });

    const taskFunction = new Function(stack, "taskFunction", {
        functionName: `${stack.stackName}-taskFunction`,
        handler: "resources/golang/main.go",
        runtime: "go1.x",
        architecture: "x86_64",
    });

    const topic = new Topic(stack, "Topic", {
        subscribers: {
            subscriber1: taskFunction,
        },
    });

    const sfRequestFunction = new Function(stack, "SfRequestFunction", {
        functionName: `${stack.stackName}-sfRequestFunction`,
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
        stateMachineName: `${stack.stackName}-RequestStateMachine`,
        definition: checkRequestShouldEnd,
    });

    const taskGetFunction = new Function(stack, "taskGetFunction", {
        functionName: `${stack.stackName}-taskGetFunction`,
        handler: "packages/functions/src/tasks/get.handler",
        permissions: ['dynamodb:GetItem'],
        memorySize: 2048,
        bind: [taskTable],
    });

    const taskCreateFunction = new Function(stack, "taskCreateFunction", {
        functionName: `${stack.stackName}-taskCreateFunction`,
        handler: "packages/functions/src/tasks/create.handler",
        permissions: [
            'states:StartExecution',
            'dynamodb:PutItem',
            'ec2:describeRegions',
            'ec2:*',
            'iam:*',
            'cloudformation:DescribeStacks',
            'ecs:RunTask',
            'ecs:RegisterTaskDefinition',
        ],
        memorySize: 2048,
        bind: [taskTable],
        environment: {
            DISPATCH_SF_ARN: dispatchStateMachine.stateMachineArn,
            REQUEST_SF_ARN: requestStateMachine.stateMachineArn,
            INSTANCE_PROFILE_NAME: ec2InstanceProfile.instanceProfileName || "",
            BUCKET_NAME: bucket.bucketName,
            ROLE_ARN: ecsTaskExecutionRole.roleArn,
            VPC_ID: vpc.vpcId,
            VPC_SUBNETS: JSON.stringify(vpcSubnets),
            SECURITY_GROUP_ID: securityGroup.securityGroupId,
            TASK_DEFINITION_FAMILY: ecsTaskDefinition.family,
            CLUSTER_NAME: ecsCluster.clusterName,
            CLUSTER_ARN: ecsCluster.clusterArn,
            CONTAINER_NAME: container.containerName,
            JOB_DEFINITION: jobDefinition.ref,
            JOB_QUEUE: jobQueue.ref,
        },
    });
    taskCreateFunction.addToRolePolicy(new PolicyStatement({
        actions: ['batch:SubmitJob'],
        resources: ['*'],
    }) as any);

    const taskListFunction = new Function(stack, "taskListFunction", {
        functionName: `${stack.stackName}-taskListFunction`,
        handler: "packages/functions/src/tasks/list.handler",
        permissions: ['dynamodb:Scan'],
        memorySize: 2048,
        bind: [taskTable]
    });

    const taskAbortFunction = new Function(stack, "taskAbortFunction", {
        functionName: `${stack.stackName}-taskAbortFunction`,
        handler: "packages/functions/src/tasks/abort.handler",
        permissions: ['states:StopExecution', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'ec2:terminateInstances', 'ecs:stopTask', 'batch:terminateJob'],
        memorySize: 2048,
        bind: [taskTable],
        environment: {
            CLUSTER_ARN: ecsCluster.clusterArn,
        }
    });

    const taskDeleteFunction = new Function(stack, "taskDeleteFunction", {
        functionName: `${stack.stackName}-taskDeleteFunction`,
        handler: "packages/functions/src/tasks/delete.handler",
        permissions: ['states:StopExecution', 'dynamodb:GetItem', 'dynamodb:DeleteItem', 'ec2:terminateInstances', 'ecs:stopTask', 'batch:terminateJob'],
        memorySize: 2048,
        bind: [taskTable],
        environment: {
            CLUSTER_ARN: ecsCluster.clusterArn,
        }
    });

    const regionsFunction = new Function(stack, "regionsFunction", {
        functionName: `${stack.stackName}-regionsFunction`,
        handler: "packages/functions/src/tasks/regions.handler",
        permissions: ['ec2:describeRegions', 'cloudformation:DescribeStacks'],
        memorySize: 2048,
    });

    const sfStateChangeLambda = new Function(stack, "sfStateChange", {
        functionName: `${stack.stackName}-sfStateChange`,
        handler: "packages/functions/src/eda/sfStateChange.handler",
        bind: [taskTable]
    });

    const fargateStateChangeLambda = new Function(stack, "fargateStateChange", {
        functionName: `${stack.stackName}-fargateStateChange`,
        handler: "packages/functions/src/eda/fargateStateChange.handler",
        bind: [taskTable]
    });

    const batchJobStateChangeLambda = new Function(stack, "batchJobStateChange", {
        functionName: `${stack.stackName}-batchJobStateChange`,
        handler: "packages/functions/src/eda/batchJobStateChange.handler",
        bind: [taskTable]
    });

    const ec2StateChangeLambda = new Function(stack, "ec2StateChange", {
        functionName: `${stack.stackName}-ec2StateChange`,
        handler: "packages/functions/src/eda/ec2StateChange.handler",
        bind: [taskTable],
        permissions: ["ec2:describeTags"]
    });

    new EventBus(stack, "Bus", {
        cdk: {
            eventBus: events.EventBus.fromEventBusName(stack, "ImportedBus", "default"),
        },
        rules: {
            stepFunctions: {
                pattern: {
                    source: ["aws.states"],
                    detailType: ["Step Functions Execution Status Change"],
                    detail: {
                        executionArn: [dispatchStateMachine.stateMachineArn]
                    }
                },
                targets: {
                    myTarget1: sfStateChangeLambda,
                },
            },
            ecs: {
                pattern: {
                    source: ["aws.ecs"],
                    detailType: ["ECS Task State Change", "ECS Container Instance State Change", "ECS Deployment State Change"],
                    detail: {
                        clusterArn: [ecsCluster.clusterArn]
                    }
                },
                targets: {
                    myTarget1: fargateStateChangeLambda,
                },
            },
            batch: {
                pattern: {
                    source: ["aws.batch"],
                    detailType: ["Batch Job State Change"],
                },
                targets: {
                    myTarget1: batchJobStateChangeLambda,
                },
            },
            ec2: {
                pattern: {
                    source: ["aws.ec2"],
                    detailType: ["EC2 Instance State-change Notification"],
                },
                targets: {
                    myTarget1: ec2StateChangeLambda,
                },
            },
        },
    });

    taskFunction.bind([logsTable, topic]);
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
            "GET /go": taskFunction,
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
        apiFunction: lambdaUrl(apiFunction.functionName, stack.region),
        RequestStateMachine: sfUrl(requestStateMachine.stateMachineArn, stack.region),
        SfRequestFunction: lambdaUrl(sfRequestFunction.functionName, stack.region),
        taskDeleteFunction: lambdaUrl(taskDeleteFunction.functionName, stack.region),
    });

    return {logsTable};
}
