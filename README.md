# Serverless Bench

## 1. What is this?

This is a tool for bench testing by AWS Serverless.

## 2. How to use it?

### 2.1 Requirements

- `node -v` >= v16.16.0
- `npm -v` >= 9.6.6
- `docker -v` >= 24.0.2
- `go version` >= go1.20.5

### 2.2 Install the CLI

```bash
npm i -g ibench
```

### 2.3 Deploy the stack

```bash
ibench deploy --region <your-region>
```

### 2.4 Remove the stack

```bash
ibench remove --region <your-region>
```

## 3. Manage Tasks by CLi

### 3.1 Show Help Options

```bash
ibench help

```

### 3.2 Create Task

```bash
# show how create a new task
ibench create --help
# create a new task in current region
ibench create --n 1 --name test --delay 10 --compute Lambda --type API --url https://api.com

# create a new task in specific region(s)
ibench create --n 1 --name test --delay 10 --compute Lambda --type API --url https://api.com --regions ap-southeast-1,us-east-2

```

### 3.3 List Tasks

```bash
# list all tasks
ibench ls

# show a specific task detail
ibench ls [taskId]

```

### 3.4 Remove Tasks

```bash
# remove all tasks
ibench rm

# remove a specific task
ibench rm [taskId]

```

### 3.5 Abort Task

```bash
# abort a specific task
ibench abort <taskId>
```

### 3.6 List Deployed Regions

```bash
# list all deployed regions
ibench regions

```

## 4. What are the benefits of using Serverless?

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

# 5. How to compute the cost?

- https://aws.amazon.com/lambda/pricing/
- https://aws.amazon.com/step-functions/pricing/
- https://aws.amazon.com/sns/pricing/

# 6. How to get cost-effective / high performance?

- Optimize the bootstrap time for cold start
- Use the right memory size
- Use the right timeout
- Use the right provisioned concurrency
- Use the right service/trigger settings
- Use the right language
- Use the right library
- Use the right region/latency
