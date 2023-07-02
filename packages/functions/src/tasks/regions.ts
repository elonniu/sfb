import {ApiHandler} from "sst/node/api";
import {jsonResponse} from "sst-helper";
import {checkStackDeployment} from "../lib/cf";

const aws_region = process.env.AWS_REGION || "";

export const handler = ApiHandler(async (_evt) => {

    return jsonResponse({
        currentRegion: aws_region,
        supportedRegions: await checkStackDeployment(),
    });

});
