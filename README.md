# Serverless Force Bench

## 1. What is this?

This is a tool for bench testing by AWS Serverless.

## 2. How to use it?

### 2.1 Requirements

- `node -v` >= v16.16.0
- `npm -v` >= 9.6.6
- `docker -v` >= 24.0.2
- `go version` >= go1.20.5
- [Setting AWS Credentials](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html)

### 2.2 Install the CLI

```bash
npm i -g sfb

```

### 2.3 Show Help Options

```bash
sfb help

```

## 3. Stack

Before using CLI, you need to first deploy the base stack in your chosen region.

> **Permissions**: Managing stacks usually requires administrator permissions.

### 3.1 Deploy

```bash
sfb deploy --region <your-region>
```

### 3.1 Remove

```bash
sfb remove --region <your-region>
```

### 3.2 List Deployed Regions

```bash
# list all deployed regions
sfb regions

```

## 4. Tasks

> **Permissions**: Using the CLI usually requires ordinary permissions:
> - lambda:invokeFunction
> - ec2:describeRegions
> - cloudformation:describeStacks

### 4.1 Create Task

```bash
# show how create a new task
sfb create --help

# create a new task in current region
sfb create --n 1 --name test --delay 10 --type API --url https://api.com

# create a new task in specific region(s)
sfb create --n 1 --name test --delay 10 --type API --url https://api.com --regions ap-southeast-1,us-east-2

```

### 4.2 List Tasks

```bash
# list all tasks
sfb ls

# show a specific task detail
sfb ls [taskId]

```

### 4.3 Remove Tasks

```bash
# remove all tasks
sfb rm

# remove a specific task
sfb rm [taskId]

```

### 4.4 Abort Task

```bash
# abort a specific task
sfb abort <taskId>
```

## 5. What are the benefits of using Serverless?

- Pay as you go: only pay for the time your code is running
- No server management: no need to worry about the infrastructure
- No idle time: no need to worry about the idle time
- Easy to develop/deploy/test/debug
- Easy to scale, Auto scaling: scale up and scale down
- Easy to integrate with other services: API Gateway, S3, SQS, SNS, DynamoDB, etc.
- Native support for many invoke methods: Sync, Async, Http, Event, Stream, CLI, SDK, etc.
- Native support for many languages: Node.js, Python, Java, C#, Go, etc.
- Native support for DLQ: Dead Letter Queue
- Native support for logging/monitoring: CloudWatch
- Native support for tracing: X-Ray
- Native support for security: IAM, KMS, VPC, etc.
- Native support for versioning: version control
- Native support for ESM settings: batch size, retry, etc.

# 6. How to compute the cost?

- https://aws.amazon.com/lambda/pricing/
- https://aws.amazon.com/step-functions/pricing/
- https://aws.amazon.com/sns/pricing/
- https://aws.amazon.com/ecs/pricing/
- https://aws.amazon.com/batch/pricing/

# 7. How to get cost-effective / high performance?

- Optimize the bootstrap time for cold start
- Use the right memory size
- Use the right timeout
- Use the right provisioned concurrency
- Use the right service/trigger settings
- Use the right language
- Use the right library
- Use the right region/latency
