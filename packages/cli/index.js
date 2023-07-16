#! /usr/bin/env node

import {program} from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import chalk from 'chalk';
import axios from 'axios';
import stripAnsi from 'strip-ansi';

import {InvokeCommand, LambdaClient} from "@aws-sdk/client-lambda";

const client = new LambdaClient();

program
    .version('0.0.1')
    .option('--stage <string>', 'stage option');

program
    .command('update')
    .description('Show current Version and check for updates')
    .action(async (taskId) => {
        await update();
    });

program
    .command('ls [taskId]')
    .description('List a task or all tasks')
    .action(async (taskId, options) => {
        if (taskId) {
            const res = await invoke('serverless-bench-Stack-taskGetFunction', {taskId});
            show([res]);
            const list = Object.entries(res.states).flatMap(([region, data]) =>
                Object.entries(data).map(([arn, status]) => ({region, arn, status}))
            );
            list.forEach(item => {
                item.jobUrl = stateUrl(item, res.compute);
            });
            table(list, ["status", "jobUrl"]);
        } else {
            const res = await invoke('serverless-bench-Stack-taskListFunction');
            taskList(res.Items);
        }
    });

program
    .command('rm [taskId]')
    .description('Delete a task or all tasks')
    .action(async (taskId, options) => {
        if (taskId) {
            const res = await invoke('serverless-bench-Stack-taskDeleteFunction', {taskId});
            taskList(res);
        } else {
            const res = await invoke('serverless-bench-Stack-taskEmptyFunction');
            taskList(res);
        }
    });

program
    .command('abort <task-id>')
    .description('Abort a task')
    .action(async (taskId, options) => {
        const res = await invoke('serverless-bench-Stack-taskAbortFunction', {taskId});
        taskList(res);
    });

program
    .command('regions')
    .description('List deployed regions')
    .action(async (options) => {
        const res = await invoke('serverless-bench-Stack-regionsFunction');
        table(res, ["region", "url"]);
    });

program
    .command('create')
    .description('Create a task')
    .option('--type <string>', 'Task type')
    .requiredOption('--name <string>', 'Task name (required)')
    .option('--report <boolean>', 'Report')
    .option('--url <string>', 'URL')
    .option('--method <string>', 'Method, default GET')
    .option('--compute <string>', 'Compute')
    .option('--key-name <string>', 'Key name')
    .option('--instance-type <string>', 'Instance type')
    .option('--qps <number>', 'QPS')
    .option('--n <number>', 'Number of requests')
    .option('--c <number>', 'Concurrency')
    .option('--delay <number>', 'Task delay seconds')
    .option('--timeout <number>', 'Timeout in milliseconds, default 5000 ms')
    .option('--success-code <number>', 'Success code')
    .option('--start-time <string>', 'Start time')
    .option('--end-time <string>', 'End time')
    .action(async (task) => {
        if (!task.qps && !task.n) {
            console.error('Error: the --qps or --n option is required');
            process.exit(1);
        }
        const res = await invoke('serverless-bench-Stack-CreateTask', task);
        taskList([res]);
    });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
    program.help();
}

async function invoke(FunctionName, payload = undefined, tip = 'Completed!') {

    const spinner = ora('Waiting...').start();
    const stage = program.opts().stage ? program.opts().stage : 'prod';

    const params = {
        FunctionName: stage + '-' + FunctionName,
        Payload: payload ? JSON.stringify(payload) : undefined,
        InvocationType: "RequestResponse",
    };

    const command = new InvokeCommand(params);

    try {
        const response = await client.send(command);

        const result = JSON.parse(new TextDecoder("utf-8").decode(response.Payload));

        if (result.success === false) {
            spinner.fail(result.msg);
            process.exit(1);
        }

        spinner.succeed(tip);

        return result.data;
    } catch (e) {
        spinner.fail(e.message);
        process.exit(1);
    }

}

function table(data, columnOrder = []) {

    const head = columnOrder !== []
        ? columnOrder.map(key => chalk.green(key))
        : Object.keys(data[0]).map(key => chalk.green(key));

    const table = new Table({
        head
    });

    data.forEach(item => {
        const row = head.map(key => {
            const value = item[stripAnsi(key)];
            return typeof value === 'object' ? JSON.stringify(value) : value;
        });
        table.push(row);
    });

    console.log(table.toString());
}

function taskList(data) {
    if (data.length === 0) {
        return;
    }

    let list = [];
    data.forEach(item => {
        const row = {
            taskId: item.taskId,
            name: item.name,
            compute: item.compute,
            url: item.url,
            qpsOrN: (item.qps ? 'qps' : 'n' + ' ') + (item.qps ? item.qps : item.n),
            c: item.c,
            startTime: item.startTime,
            endTime: item.endTime,
            status: item.status
        };
        list.push(row);
    });

    table(list, ["taskId", "name", "compute", "status", "qpsOrN", "c", "startTime", "endTime", "url"]);
}

async function update() {
    try {
        const response = await axios.get('https://registry.npmjs.org/ibench');
        const serverVersion = response.data['dist-tags'].latest;
        if (serverVersion !== program.version()) {
            console.log(chalk.yellow(`A new version of the tool is available. Please update to version ${serverVersion} by running the command: npm install -g ibench`));
        } else {
            console.log('You are using the latest version of the CLI: ' + chalk.green(`${serverVersion}`));
        }
    } catch (error) {
        console.error(chalk.red('Failed to check for updates.'));
    }
}

function show(data) {
    const colWidths = [20, 40, 20, 40];

    const table = new Table({
        head: [chalk.yellow('Key1'), chalk.green('Value1'), chalk.yellow('Key2'), chalk.green('Value2')],
        colWidths,
    });

    data.forEach(item => {
        const entries = Object.entries(item);
        for (let i = 0; i < entries.length; i += 2) {
            const row = [
                chalk.yellow(entries[i][0]),
                chalk.green(typeof entries[i][1] === 'object' ? JSON.stringify(entries[i][1]) : entries[i][1]),
                entries[i + 1] ? chalk.yellow(entries[i + 1][0]) : '',
                entries[i + 1] && typeof entries[i + 1][1] === 'object' ? chalk.green(JSON.stringify(entries[i + 1][1])) : entries[i + 1] ? chalk.green(entries[i + 1][1]) : '',
            ];
            table.push(row);
        }
    });

    console.log(table.toString());
}

function stateUrl(item, compute) {
    switch (compute) {
        case 'Lambda':
            return executionUrl(item.arn, item.region);
        case 'EC2':
            return ec2Url(item.arn, item.region);
        case 'Fargate':
            return fargateUrl(item.arn, item.region);
        case 'Batch':
            return batchUrl(item.arn, item.region);
        default:
            return "";
    }

}

function fargateUrl(arn, region) {
    return `https://${region}.console.${awsDomain(region)}/ecs/v2/clusters/${arn.split('/')[1]}/tasks/${arn.split('/')[2]}/configuration?region=${region}&selectedContainer=TaskContainer`;
}

function batchUrl(arn, region) {
    return `https://${region}.console.${awsDomain(region)}/batch/home?region=${region}#jobs/fargate/detail/${arn}`;
}

function executionUrl(arn, region) {
    return `https://${region}.console.${awsDomain(region)}/states/home?region=${region}#/v2/executions/details/${arn}`;
}

function ec2Url(arn, region) {
    return `https://${region}.console.${awsDomain(region)}/ec2/home?region=${region}#InstanceDetails:instanceId=${arn}`;
}

export function awsDomain(region) {
    if (region && region.startsWith('cn')) {
        return `amazonaws.cn`;
    }

    return `aws.amazon.com`;
}
