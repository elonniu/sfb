#!/bin/bash

aws lambda invoke --function-name dev-serverless-bench-Stack-taskListFunction --query 'Payload' /dev/stdout | jq
