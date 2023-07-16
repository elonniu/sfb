#!/bin/bash

$(aws lambda invoke --payload $(cat task-batch.json | base64) --function-name dev-serverless-bench-Stack-CreateTask result.json)
cat result.json | jq
