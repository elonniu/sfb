import {checkStackDeployment} from "../lib/cf";
import {sortKeys} from "sst-helper";

const aws_region = process.env.AWS_REGION || "";

export async function handler() {

    return sortKeys({
        currentRegion: aws_region,
        deployedRegions: await checkStackDeployment(),
    });

}
