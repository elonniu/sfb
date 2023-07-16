#!/bin/bash

aws lambda invoke --function-name dev-serverless-bench-Stack-taskEmptyFunction /dev/stdout --query 'Payload' /dev/stdout | jq
