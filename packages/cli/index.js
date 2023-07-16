#! /usr/bin/env node

import {Command} from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import chalk from 'chalk';
import axios from 'axios';
import stripAnsi from 'strip-ansi';
import {spawn} from 'child_process';
import {InvokeCommand, LambdaClient} from "@aws-sdk/client-lambda";
import {batchJobUrl, currentVersion, ec2InstanceUrl, executionUrl, fargateTaskUrl, getRoot} from "sst-helper";

const program = new Command();

program
    .version(await currentVersion())
    .option('--stage <string>', 'stage option')
    .option('--region <string>', 'AWS region')
    .option('--profile <string>', 'AWS profile');

program
    .command('dev')
    .description('Run the dev script')
    .action(() => {
        const options = program.opts();
        const args = [];
        options.region && args.push(`--region=${options.region}`);
        options.profile && args.push(`--profile=${options.profile}`);
        const child = spawn('npm',
            ['run', 'dev', '--', ...args],
            {stdio: 'inherit', cwd: getRoot()}
        );
    });

program
    .command('deploy')
    .description('Deploy the app in a region')
    .action(async () => {
        await update();
        const options = program.opts();
        const args = [];
        if (!options.region) {
            console.error('Error: the --region option is required');
            process.exit(1);
        }
        options.region && args.push(`--region=${options.region}`);
        options.profile && args.push(`--profile=${options.profile}`);
        args.push(`--stage=prod`);
        const child = spawn('npm',
            ['run', 'deploy', '--', ...args],
            {stdio: 'inherit', cwd: getRoot()}
        );
    });

program
    .command('remove')
    .description('Remove the app from a region')
    .action(async (task) => {
        await update();
        const options = program.opts();
        const args = [];
        if (!options.region) {
            console.error('Error: the --region option is required');
            process.exit(1);
        }
        options.region && args.push(`--region=${options.region}`);
        options.profile && args.push(`--profile=${options.profile}`);
        args.push(`--stage=prod`);
        const child = spawn('npm',
            ['run', 'remove', '--', ...args],
            {stdio: 'inherit', cwd: getRoot()}
        );
    });

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
            table(list, ["region", "status", "jobUrl"]);
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
    .requiredOption('--name <string>', 'Task name (required)')
    .option('--type <string>', 'Task type')
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
    .option('--regions <string>', 'Target regions, example: us-east-1,us-west-2')
    .action(async (task) => {
        if (!task.qps && !task.n) {
            console.error('Error: the --qps or --n option is required');
            process.exit(1);
        }
        if (task.regions) {
            task.regions = task.regions.split(',');
        }
        const res = await invoke('serverless-bench-Stack-CreateTask', task);
        taskList([res]);
    });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
    program.help();
}

async function invoke(Name, payload = undefined, tip = 'Completed!') {

    const client = new LambdaClient({region: program.opts().region});

    const spinner = ora('Waiting...').start();
    const stage = program.opts().stage ? program.opts().stage : 'prod';
    const FunctionName = stage + '-' + Name;

    const params = {
        FunctionName,
        Payload: payload ? JSON.stringify(payload) : undefined,
        InvocationType: "RequestResponse",
    };

    const command = new InvokeCommand(params);

    try {
        const response = await client.send(command);

        const result = JSON.parse(new TextDecoder("utf-8").decode(response.Payload));

        if (result.success === false) {
            spinner.fail(chalk.red(result.msg + " in " + FunctionName));
            if (result.log) {
                console.log(chalk.yellow(`Log: ${result.log}`));
            }
            process.exit(1);
        }

        spinner.succeed(tip);

        return result.data;
    } catch (e) {
        if (e.message.indexOf('Function not found') !== -1) {
            spinner.fail(`Your need deploy the serverless-bench first.`);
        } else {
            spinner.fail(e.message);
        }

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
            console.log(chalk.yellow(`Your version is ${chalk.red(program.version())}, A new version ${chalk.green(serverVersion)} is available. Please update by running the command: ${chalk.blue('npm install -g ibench')}`));
            process.exit(1);
        } else {
            console.log('You are using the latest version: ' + chalk.green(`${serverVersion}`));
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
            return ec2InstanceUrl(item.arn, item.region);
        case 'Fargate':
            return fargateTaskUrl(item.arn, item.region);
        case 'Batch':
            return batchJobUrl(item.arn, item.region);
        default:
            return "";
    }

}
