import {snsBatch} from "./sns";
import {Topic} from "sst/node/topic";
import console from "console";

export async function handler(event: any) {

    const {url, batch, timeout, qps, startTime, endTime} = event.Payload;

    console.log({url, batch, timeout, qps, startTime, endTime});

    // now between startTime and endTime
    const now = new Date().getTime();
    if (now < new Date(startTime).getTime()) {
        await delay();
        return {shouldEnd: false, url, batch, timeout, qps, startTime, endTime};
    }

    if (now > new Date(endTime).getTime()) {
        return {shouldEnd: true};
    }

    if (batch) {
        let sqsMessages = [];
        for (let i = 0; i < batch; i++) {
            sqsMessages.push({url, batch, timeout, qps, startTime, endTime});
        }
        await snsBatch(Topic.Topic.topicArn, sqsMessages);
        return {shouldEnd: true};
    }

    let sqsMessages = [];
    for (let i = 0; i < qps; i++) {
        sqsMessages.push({url, batch, timeout, qps, startTime, endTime});
    }
    await snsBatch(Topic.Topic.topicArn, sqsMessages);

    await delay();
    return {shouldEnd: false, url, batch, timeout, qps, startTime, endTime};
}

function delay() {
    // get the milliseconds until the next second.
    const ms = 1000 - new Date().getMilliseconds();
    console.log(`delay ${ms} milliseconds until the next second`);
    return new Promise(resolve => setTimeout(resolve, ms));
}
