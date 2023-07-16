#!/bin/bash

aws lambda invoke --function-name dev-serverless-bench-Stack-regionsFunction --query 'Payload' /dev/stdout | jq
