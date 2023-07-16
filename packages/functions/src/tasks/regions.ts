import {checkStackDeployment} from "../lib/cf";
import {bad, ok} from "../common";

const current_region = process.env.AWS_REGION || "";

export async function handler() {

    try {
        const list = await checkStackDeployment();
        let regions = [];

        for (const region of list) {
            regions.push({
                region: region,
                current: region === current_region,
            });
        }

        return ok(regions);

    } catch (e: any) {
        return bad(e);
    }
}
