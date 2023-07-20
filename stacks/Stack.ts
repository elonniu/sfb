import {Bucket, EventBus, Function, KinesisStream, StackContext, Table, Topic} from "sst/constructs";
import {stackUrl} from "sst-helper";
import {Choice, Condition, JsonPath, Pass, StateMachine, TaskInput} from 'aws-cdk-lib/aws-stepfunctions';
import {LambdaInvoke} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from "aws-cdk-lib/aws-events";
import {ManagedPolicy, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {SecurityGroup, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import * as batch from "aws-cdk-lib/aws-batch";
import {Cluster, Compatibility, ContainerImage, LogDrivers, NetworkMode, TaskDefinition} from "aws-cdk-lib/aws-ecs";
import * as fs from "fs";
import {Duration} from "aws-cdk-lib";
import {StreamMode} from "aws-cdk-lib/aws-kinesis";

const dockerImage = 'public.ecr.aws/elonniu/sfb:latest';

export function Stack({stack}: StackContext) {

    const version = JSON.parse(fs.readFileSync("./package.json", 'utf-8')).version;

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
        clusterName: stack.stackName,
        containerInsights: true,
    });

    const ecsTaskExecutionRole = new Role(stack, "ecsTaskExecutionRole", {
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

    const container = ecsTaskDefinition.addContainer('Task', {
        image: ContainerImage.fromRegistry(dockerImage),
        logging: LogDrivers.awsLogs({streamPrefix: 'TaskLogs'}),
    });

    const batchRole = new Role(stack, 'batchRole', {
        assumedBy: new ServicePrincipal('batch.amazonaws.com'),
    });

    batchRole.addToPolicy(new PolicyStatement({
        actions: ['logs:DescribeLogGroups', 'ecs:ListClusters', 'logs:CreateLogGroup'],
        resources: ['*'],
    }));

    const batchComputeEnvironment = new batch.CfnComputeEnvironment(stack, 'computeEnvironment', {
        computeEnvironmentName: stack.stackName,
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
            image: dockerImage,
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

    const bucket = new Bucket(stack, "bucket");

    const taskTable = new Table(stack, "tasks", {
        fields: {
            taskId: "string",
        },
        primaryIndex: {partitionKey: "taskId"},
    });

    const taskFunction = new Function(stack, "taskFunction", {
        functionName: `${stack.stackName}-taskFunction`,
        handler: "resources/golang/main.go",
        runtime: "go1.x",
        architecture: "x86_64",
        bind: [bucket],
    });

    const topic = new Topic(stack, "Topic", {
        subscribers: {
            subscriber1: taskFunction,
        },
    });

    const executionFunction = new Function(stack, "executionFunction", {
        functionName: `${stack.stackName}-executionFunction`,
        handler: "packages/functions/src/sf/execution.handler",
        memorySize: 4048,
        permissions: ['states:DescribeExecution', 'cloudwatch:PutMetricData', 'lambda:InvokeFunction'],
        bind: [topic],
        environment: {
            taskFunction: taskFunction.functionName
        }
    });

    const requestLambdaTask = new LambdaInvoke(stack, 'Invoke Request Lambda', {
        lambdaFunction: executionFunction,
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
        stateMachineName: stack.stackName,
        definition: checkRequestShouldEnd,
    });

    new Function(stack, "taskGetFunction", {
        functionName: `${stack.stackName}-taskGetFunction`,
        handler: "packages/functions/src/tasks/get.handler",
        permissions: ['dynamodb:GetItem'],
        memorySize: 2048,
        bind: [taskTable],
    });

    const kds = new KinesisStream(stack, "Stream", {
        cdk: {
            stream: {
                retentionPeriod: Duration.days(1),
                streamMode: StreamMode.ON_DEMAND
            },
        },
    });
    kds.cdk.stream.grantWrite(ecsTaskExecutionRole);

    const taskGenerateFunction = new Function(stack, "taskGenerateFunction", {
        functionName: `${stack.stackName}-taskGenerateFunction`,
        handler: "packages/functions/src/tasks/generate.handler",
        permissions: [
            'ecs:RunTask',
            'iam:PassRole',
            'states:StartExecution',
            'dynamodb:PutItem',
        ],
        memorySize: 2048,
        bind: [taskTable],
        environment: {
            VPC_SUBNETS: JSON.stringify(vpcSubnets),
            SECURITY_GROUP_ID: securityGroup.securityGroupId,
            REQUEST_SF_ARN: requestStateMachine.stateMachineArn,
            BUCKET_NAME: bucket.bucketName,
            TASK_DEFINITION_FAMILY: ecsTaskDefinition.family,
            CLUSTER_NAME: ecsCluster.clusterName,
            CLUSTER_ARN: ecsCluster.clusterArn,
            CONTAINER_NAME: container.containerName,
            JOB_DEFINITION: jobDefinition.ref,
            JOB_QUEUE: jobQueue.ref,
            KDS_NAME: kds.streamName,
        },
    });
    taskGenerateFunction.addToRolePolicy(new PolicyStatement({
        actions: ['batch:SubmitJob'],
        resources: ['*'],
    }) as any);

    taskFunction.addToRolePolicy(new PolicyStatement({
        actions: ['kinesis:PutRecord'],
        resources: ['*'],
    }) as any);

    new Function(stack, "taskCreateFunction", {
        functionName: `${stack.stackName}-CreateTask`,
        handler: "packages/functions/src/tasks/create.handler",
        permissions: [
            'ec2:describeRegions',
            'cloudformation:DescribeStacks',
            'lambda:InvokeFunction'
        ],
        memorySize: 2048,
        environment: {
            TASK_GENERATE_FUNCTION: taskGenerateFunction.functionName,
            TASK_VERSION: version,
        },
    });

    new Function(stack, "taskListFunction", {
        functionName: `${stack.stackName}-taskListFunction`,
        handler: "packages/functions/src/tasks/list.handler",
        permissions: ['dynamodb:Scan'],
        memorySize: 2048,
        bind: [taskTable]
    });

    new Function(stack, "taskAbortFunction", {
        functionName: `${stack.stackName}-taskAbortFunction`,
        handler: "packages/functions/src/tasks/abort.handler",
        permissions: ['states:StopExecution', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'ecs:stopTask', 'batch:terminateJob'],
        memorySize: 2048,
        bind: [taskTable],
        environment: {
            CLUSTER_ARN: ecsCluster.clusterArn,
        }
    });

    new Function(stack, "taskDeleteFunction", {
        functionName: `${stack.stackName}-taskDeleteFunction`,
        handler: "packages/functions/src/tasks/delete.handler",
        permissions: ['states:StopExecution', 'dynamodb:GetItem', 'dynamodb:DeleteItem', 'ecs:stopTask', 'batch:terminateJob'],
        memorySize: 2048,
        bind: [taskTable],
        environment: {
            CLUSTER_ARN: ecsCluster.clusterArn,
        }
    });

    new Function(stack, "taskEmptyFunction", {
        functionName: `${stack.stackName}-taskEmptyFunction`,
        handler: "packages/functions/src/tasks/empty.handler",
        permissions: ['states:StopExecution', 'dynamodb:GetItem', 'dynamodb:DeleteItem', 'ecs:stopTask', 'batch:terminateJob'],
        memorySize: 2048,
        bind: [taskTable],
        environment: {
            CLUSTER_ARN: ecsCluster.clusterArn,
        }
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
                        stateMachineArn: [requestStateMachine.stateMachineArn]
                    }
                },
                targets: {
                    myTarget1: sfStateChangeLambda,
                },
            },
            ecs: {
                pattern: {
                    source: ["aws.ecs"],
                    detailType: ["ECS Task State Change"],
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
                    detail: {
                        jobDefinition: [jobDefinition.ref]
                    }
                },
                targets: {
                    myTarget1: batchJobStateChangeLambda,
                },
            },
        },
    });

    stack.tags.setTag("version", version);

    stack.addOutputs({
        stack: stackUrl(stack.stackId, stack.region),
    });

}
