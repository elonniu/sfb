#!/bin/bash

aws lambda invoke --payload $(cat task.json | base64) --function-name dev-serverless-bench-Stack-CreateTask --query 'Payload' /dev/stdout | jq
