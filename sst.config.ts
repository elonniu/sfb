import {SSTConfig} from "sst";
import {Stack} from "./stacks/Stack";
import {RemovalPolicy} from "aws-cdk-lib";

export default {
    config(_input) {
        return {
            name: "serverless-bench",
            region: "ap-southeast-1",
        };
    },
    stacks(app) {
        app.setDefaultRemovalPolicy(RemovalPolicy.DESTROY);
        app.setDefaultFunctionProps({
            architecture: "arm_64",
            runtime: "nodejs18.x",
            timeout: 90,
            environment: {
                SOURCE_IP: process.env.SOURCE_IP || ""
            }
        });
        app.stack(Stack);
    }
} satisfies SSTConfig;
