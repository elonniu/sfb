#!/bin/bash

aws lambda invoke --payload $(cat result.json | base64) --function-name dev-serverless-bench-Stack-taskGetFunction /dev/stdout | jq
