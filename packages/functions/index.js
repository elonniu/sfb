#! /usr/bin/env node

import {Command} from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import chalk from 'chalk';
import axios from 'axios';
import stripAnsi from 'strip-ansi';
import {spawn} from 'child_process';
import {InvokeCommand, LambdaClient} from "@aws-sdk/client-lambda";
import {
    batchJobUrl,
    currentVersion,
    ec2InstanceUrl,
    executionUrl,
    fargateTaskUrl,
    getRoot,
    stackExistsAndCompleteInAllRegions
} from "sst-helper";

const program = new Command();

program
    .version(await currentVersion())
    .option('--stage <string>', 'stage option')
    .option('--region <string>', 'AWS region')
    .option('--profile <string>', 'AWS profile');

// program
//     .command('dev')
//     .description('Run the dev script')
//     .action(() => {
//         const options = program.opts();
//         const args = [];
//         options.region && args.push(`--region=${options.region}`);
//         options.profile && args.push(`--profile=${options.profile}`);
//         const child = spawn('npm',
//             ['run', 'dev', '--', ...args],
//             {stdio: 'inherit', cwd: getRoot()}
//         );
//     });

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
    .command('ls [taskId]')
    .description('List a task or all tasks')
    .action(async (taskId, options) => {
        await update();
        if (taskId) {
            const res = await invoke('taskGetFunction', {taskId});
            showTask(res);
        } else {
            const res = await invoke('taskListFunction');
            taskList(res.Items);
        }
    });

program
    .command('rm [taskId]')
    .description('Delete a task or all tasks')
    .action(async (taskId, options) => {
        await update();
        if (taskId) {
            const res = await invoke('taskDeleteFunction', {taskId});
            taskList(res);
        } else {
            const res = await invoke('taskEmptyFunction');
            taskList(res);
        }
    });

program
    .command('abort <task-id>')
    .description('Abort a task')
    .action(async (taskId, options) => {
        await update();
        const res = await invoke('taskAbortFunction', {taskId});
        taskList(res);
    });

program
    .command('report <task-id>')
    .description('Show a task report data')
    .action(async (taskId, options) => {
        await update();
        console.log(chalk.blue("This feature is not implemented yet..."));
    });

program
    .command('regions')
    .description('List deployed regions')
    .action(async (options) => {
        await update();
        const stage = program.opts().stage ? program.opts().stage : 'prod';
        const spinner = ora('Fetching...').start();
        const stackName = `serverless-bench-${stage}`;
        const stacks = await stackExistsAndCompleteInAllRegions(stackName);
        if (stacks.length === 0) {
            spinner.fail("No deployed regions");
            process.exit(1);
        }
        spinner.succeed("Only show completed stacks:");
        for (const stack of stacks) {
            stack.version = 'none';
            stack.needUpdate = true;
            for (const tag of stack.Tags) {
                if (tag.Key === 'version') {
                    stack.version = tag.Value;
                }
            }
            if (stack.version) {
                if (stack.version === await currentVersion()) {
                    stack.version = chalk.green(stack.version);
                    stack.needUpdate = false;
                } else {
                    stack.version = chalk.red(stack.version);
                }
            }
        }
        table(stacks, ["region", "version", "url"]);
        for (const stack of stacks) {
            if (stack.needUpdate) {
                console.log(
                    "Need update version "
                    + chalk.red(stack.version)
                    + " -> "
                    + chalk.green(await currentVersion())
                    + " Command: "
                    + chalk.yellow(`ibench deploy --region ${stack.region} ${stageParam()}`)
                );
            }
        }
    });

program
    .command('create')
    .description('Create a task')
    .requiredOption('--name <string>', 'Task name (required)')
    .option('--type <string>', 'Task type')
    .option('--report <boolean>', 'Report')
    .option('--url <string>', 'URL')
    .option('--method <string>', 'Method, default GET')
    .option('--compute <string>', 'Compute Type, default Fargate, others: EC2, Lambda, Batch')
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
        await update();
        if (!task.qps && !task.n) {
            console.error('Error: the --qps or --n option is required');
            process.exit(1);
        }
        if (task.regions) {
            task.regions = task.regions.split(',');
        }
        const res = await invoke('CreateTask', task);
        showTask(res);
    });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
    program.help();
}

async function invoke(name, payload = undefined, tip = 'Completed!') {

    const client = new LambdaClient({region: program.opts().region});

    const spinner = ora('Fetching...').start();
    const stage = program.opts().stage ? program.opts().stage : 'prod';
    const FunctionName = `serverless-bench-${name}-${stage}`;

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
            spinner.fail(chalk.red(result.msg));
            if (result.log) {
                console.log(chalk.yellow(`Log: ${result.log}`));
            }
            process.exit(1);
        }

        if (result.data && result.data.Items && result.data.Items.length === 0) {
            spinner.succeed("No data");
        } else {
            spinner.succeed(tip);
        }

        return result.data;
    } catch (e) {
        if (e.message.indexOf('Function not found') !== -1) {
            spinner.fail(chalk.red('Current region not deployed stack yet.'));
            spinner.fail(`Your can run ${chalk.yellow('ibench deploy')} to deploy the stack in current region before use.`);
            spinner.fail('Or run ' + chalk.yellow('ibench regions') + ' to show all deployed regions and ' + `add ${chalk.yellow('--region <region>')} to specify the region for you command.`);
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
            region: item.region,
            url: item.url,
            qpsOrN: (item.qps ? 'qps' : 'n' + ' ') + (item.qps ? item.qps : item.n),
            c: item.c,
            startTime: item.startTime,
            endTime: item.endTime,
            status: item.status
        };
        list.push(row);
    });

    table(list, ["taskId", "name", "region", "status", "qpsOrN", "c", "startTime", "endTime", "url"]);
}

async function update() {
    const spinner = ora('Waiting...').start();
    try {
        const response = await axios.get('https://registry.npmjs.org/ibench');
        const serverVersion = response.data['dist-tags'].latest;
        if (serverVersion !== program.version()) {
            spinner.stop();
            console.log(chalk.yellow(`A new version ${chalk.green(serverVersion)} is available. Your version is ${chalk.red(program.version())}, Please update by run: ${chalk.blue('npm i -g ibench')}`));
            process.exit(1);
        }
    } catch (error) {
        console.error(chalk.red('Failed to check for updates.'));
    }
    spinner.stop();
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

function showTask(res) {
    show([res]);
    console.log("Task Jobs:");
    const list = Object.entries(res.states).flatMap(([region, data]) =>
        Object.entries(data).map(([arn, status]) => ({region, arn, status}))
    );
    list.forEach(item => {
        item.jobUrl = stateUrl(item, res.compute);
    });
    table(list, ["region", "status", "jobUrl"]);
    console.log(
        "Refresh Task Status: "
        + chalk.yellow(`ibench ls ${res.taskId} ${stageParam()}`)
    );
}

function stageParam() {
    return program.opts().stage ? `--stage ${program.opts().stage}` : ""
}
