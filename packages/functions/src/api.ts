import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";

export const handler = ApiHandler(async (_evt) => {

    return jsonResponse({msg: "ok"});

});
