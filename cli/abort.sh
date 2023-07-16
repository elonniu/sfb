#!/bin/bash

aws lambda invoke --payload $(cat taskId.json | base64) --function-name dev-serverless-bench-Stack-taskAbortFunction --query 'Payload' /dev/stdout | jq
