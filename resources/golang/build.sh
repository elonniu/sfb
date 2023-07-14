#!/bin/bash

docker build . -t public.ecr.aws/elonniu/serverless-bench:latest && docker run public.ecr.aws/elonniu/serverless-bench:latest

aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/elonniu

docker push public.ecr.aws/elonniu/serverless-bench:latest
