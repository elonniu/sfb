import {getStackDeployments} from "../lib/cf";
import {bad, ok} from "../common";
import {stackUrl} from "sst-helper";

export async function handler(event: any, context: any) {

    try {
        const list = await getStackDeployments();

        const result = [];
        for (const stack of list) {
            if (stack) {
                result.push({
                    ...stack,
                    url: stackUrl(stack.StackId, stack.region),
                } as any);
            }
        }

        return ok(result);

    } catch (e: any) {
        return bad(e, context);
    }
}
