import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import {getTaskGlobal} from "../common";

const current_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    const region = _evt.queryStringParameters?.region || current_region;

    const taskId = _evt.pathParameters?.id || "";

    try {
        const globalTasks = await getTaskGlobal(taskId, region);

        let task = {...globalTasks[0]};

        task.states = {};

        for (let i = 0; i < globalTasks.length; i++) {
            const globalTask = globalTasks[i];
            task.states[globalTask.region] = globalTask.states;
        }

        return jsonResponse(task);
    } catch (e: any) {
        return jsonResponse({
            error: e.message
        });
    }

});
