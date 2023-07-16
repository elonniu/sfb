import {checkStackDeployment} from "../lib/cf";
import {sortKeys} from "sst-helper";

const region = process.env.AWS_REGION || "";

export async function handler() {

    return sortKeys({
        currentRegion: region,
        deployedRegions: await checkStackDeployment(),
    });

}
