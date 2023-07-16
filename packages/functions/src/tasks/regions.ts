import {getStackDeployments} from "../lib/cf";
import {bad, ok} from "../common";
import {stackUrl} from "sst-helper";

const current_region = process.env.AWS_REGION || "";

export async function handler() {

    try {
        const list = await getStackDeployments();
        for (const stack of list) {
            stack.url = stackUrl(stack.StackId, current_region);
        }
        return ok(list);

    } catch (e: any) {
        return bad(e);
    }
}
