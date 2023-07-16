import {checkStackDeployment} from "../lib/cf";
import {bad, ok} from "../common";

const region = process.env.AWS_REGION || "";

export async function handler() {

    try {
        return ok({
            currentRegion: region,
            deployedRegions: await checkStackDeployment(),
        });
    } catch (e: any) {
        return bad(e);
    }
}
