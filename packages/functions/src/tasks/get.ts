import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import {getTaskGlobal} from "../common";

const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    const region = _evt.queryStringParameters?.region || current_region;

    const taskId = _evt.pathParameters?.id || "";

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        return jsonResponse({
            task: globalTasks
        });
    } catch (e: any) {
        return jsonResponse({
            error: e.message
        });
    }

});
