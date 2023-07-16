#!/bin/bash

aws lambda invoke --function-name dev-serverless-bench-Stack-taskListFunction /dev/stdout | jq
