import {getStackDeployments} from "../lib/cf";
import {bad, ok} from "../common";
import {stackUrl} from "sst-helper";

export async function handler(event: any, context: any) {

    try {
        const list = await getStackDeployments();
        for (const stack of list) {
            stack.url = stackUrl(stack.StackId, stack.region);
        }
        return ok(list);

    } catch (e: any) {
        return bad(e, context);
    }
}
