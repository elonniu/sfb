import {checkStackDeployment} from "../lib/cf";
import {ok} from "../common";

const region = process.env.AWS_REGION || "";

export async function handler() {

    return ok({
        currentRegion: region,
        deployedRegions: await checkStackDeployment(),
    });

}
