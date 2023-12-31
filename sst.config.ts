import {SSTConfig} from "sst";
import {Stack} from "./stacks/Stack";
import {RemovalPolicy} from "aws-cdk-lib";

export default {
    config(_input) {
        return {
            name: "sfb",
            region: "ap-southeast-1",
            bootstrap: {
                useCdkBucket: true
            }
        };
    },
    stacks(app) {
        app.setDefaultRemovalPolicy(RemovalPolicy.DESTROY);
        app.setDefaultFunctionProps({
            architecture: "arm_64",
            runtime: "nodejs18.x",
            timeout: 90,
        });
        app.stack(Stack, {
            stackName: `${app.name}-${app.stage}`,
        });
    }
} satisfies SSTConfig;
