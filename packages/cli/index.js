#! /usr/bin/env node

import {program} from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import chalk from 'chalk';
import axios from 'axios';

import {InvokeCommand, LambdaClient} from "@aws-sdk/client-lambda";

const client = new LambdaClient();

function table(data, colWidths) {

    const head = Object.keys(colWidths);

    const table = new Table({
        head,
        colWidths: Object.values(colWidths),
    });

    data.forEach(item => {
        const row = head.map(key => {
            const value = item[key];
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
            url: item.url,
            qpsOrN: (item.qps ? 'qps' : 'n' + ' ') + (item.qps ? item.qps : item.n),
            c: item.c,
            startTime: item.startTime,
            endTime: item.endTime,
            createdAt: item.createdAt,
            status: item.status
        };
        list.push(row);
    });

    table(list, {
        taskId: 17,
        name: 10,
        status: 8,
        url: 24,
        qpsOrN: 10,
        c: 5,
        startTime: 26,
        endTime: 26,
        createdAt: 26,
    });
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

program
    .version('0.0.1');

program
    .command('version')
    .description('Show current CLi Version and check for updates')
    .action(async (taskId) => {
        await update();
    });

program
    .command('ls [taskId]')
    .description('List a task or all tasks')
    .action(async (taskId) => {
        if (taskId) {
            const res = await invoke('dev-serverless-bench-Stack-taskGetFunction', {taskId});
            show([res]);
        } else {
            const res = await invoke('dev-serverless-bench-Stack-taskListFunction');
            taskList(res.Items);
        }
    });

program
    .command('rm [taskId]')
    .description('Delete a task or all tasks')
    .action(async (taskId) => {
        if (taskId) {
            const res = await invoke('dev-serverless-bench-Stack-taskDeleteFunction', {taskId});
            taskList([res]);
        } else {
            const res = await invoke('dev-serverless-bench-Stack-taskEmptyFunction');
            taskList(res);
        }
    });

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

program
    .command('abort <task-id>')
    .description('Abort a task')
    .action(async (taskId) => {
        const res = await invoke('dev-serverless-bench-Stack-taskAbortFunction', {taskId});
        taskList(res);
    });

program
    .command('regions')
    .description('List all deployed regions')
    .action(async () => {
        const res = await invoke('dev-serverless-bench-Stack-regionsFunction');
        table([res], {currentRegion: 20, deployedRegions: 50});
    });

program
    .command('create')
    .description('Create a task')
    .option('--type <string>', 'Task type')
    .option('--name <string>', 'Task name (required)')
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
        if (!task.name) {
            console.error('Error: the --name option is required');
            process.exit(1);
        }
        if (!task.qps && !task.n) {
            console.error('Error: the --qps or --n option is required');
            process.exit(1);
        }
        const res = await invoke('dev-serverless-bench-Stack-CreateTask', task);
        taskList([res]);
    });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
    program.help();
}

async function invoke(FunctionName, payload = undefined, tip = 'Completed!') {

    const spinner = ora('Waiting...').start();

    const params = {
        FunctionName,
        Payload: payload ? JSON.stringify(payload) : undefined,
        InvocationType: "RequestResponse",
    };

    const command = new InvokeCommand(params);

    const response = await client.send(command);

    const result = JSON.parse(new TextDecoder("utf-8").decode(response.Payload));

    if (result.success === false) {
        spinner.fail(result.msg);
        process.exit(1);
    }

    spinner.succeed(tip);

    return result.data;
}

