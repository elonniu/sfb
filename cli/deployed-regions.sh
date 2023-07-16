#!/bin/bash

aws lambda invoke --function-name dev-serverless-bench-Stack-regionsFunction /dev/stdout | jq
