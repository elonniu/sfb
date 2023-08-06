#! /usr/bin/env node

import {Command} from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import chalk from 'chalk';
import axios from 'axios';
import stripAnsi from 'strip-ansi';
import {spawn} from 'child_process';
import {InvokeCommand, LambdaClient} from "@aws-sdk/client-lambda";
import {fromIni} from "@aws-sdk/credential-provider-ini";
import {GetCallerIdentityCommand, STSClient} from "@aws-sdk/client-sts";
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
    .version(await currentVersion('sfb'))
    .option('--stage <string>', 'stage option')
    .option('--region <string>', 'AWS region')
    .option('--profile <string>', 'AWS profile');

program
    .command('deploy')
    .description('Deploy the app in a region')
    .action(async () => {
        await versionCheck();
        const region = await currentRegion();
        const options = program.opts();
        const args = [];
        args.push(`--region=${region}`);
        options.profile && args.push(`--profile=${options.profile}`);
        args.push(`--stage=${getStageName()}`);
        const child = spawn('npm',
            ['run', 'deploy', '--', ...args],
            {stdio: 'inherit', cwd: getRoot('sfb')}
        );
    });

program
    .command('remove')
    .description('Remove the app from a region')
    .action(async (task) => {
        await versionCheck();
        const region = await currentRegion();
        const options = program.opts();
        const args = [];
        args.push(`--region=${region}`);
        options.profile && args.push(`--profile=${options.profile}`);
        args.push(`--stage=${getStageName()}`);
        const child = spawn('npm',
            ['run', 'remove', '--', ...args],
            {stdio: 'inherit', cwd: getRoot('sfb')}
        );
    });

program
    .command('ls [taskId]')
    .description('List a task or all tasks')
    .action(async (taskId, options) => {
        await versionCheck();
        await currentRegion();
        if (taskId) {
            await getTask(taskId);
        } else {
            await getTasks();
        }
    });

program
    .command('rm [taskId]')
    .description('Delete a task or all tasks')
    .action(async (taskId, options) => {
        await versionCheck();
        await currentRegion();
        if (taskId) {
            await invoke('taskDeleteFunction', {taskId}, 'Task was deleted, it\'s states will be abort in a few seconds.');
        } else {
            await invoke('taskEmptyFunction', {}, 'Tasks was empty, it\'s states will be abort in a few seconds.');
        }
    });

program
    .command('abort <task-id>')
    .description('Abort a task')
    .action(async (taskId, options) => {
        await versionCheck();
        await currentRegion();
        await invoke('taskAbortFunction', {taskId}, 'Task abort command was sent, It will take a few seconds to take effects.');
        console.log(chalk.green("You can get states by run: ") + chalk.yellow(`sfb ls ${taskId}${regionParam()}${stageParam()}${profileParam()}`));
    });

program
    .command('report <task-id>')
    .description('Show a task report data')
    .action(async (taskId, options) => {
        await versionCheck();
        await currentRegion();
        console.log(chalk.blue("This feature is not implemented yet..."));
    });

program
    .command('regions')
    .description('List deployed regions')
    .action(async (options) => {
        await versionCheck();
        await currentRegion();
        const spinner = ora('Processing...').start();
        const stackName = `sfb-${getStageName()}`;
        let stacks;
        try {
            stacks = await stackExistsAndCompleteInAllRegions(stackName, await credentials());
        } catch (e) {
            spinner.fail(e.message);
            process.exit(1);
        }
        if (stacks.length === 0) {
            spinner.fail("No deployed regions");
            process.exit(1);
        }
        spinner.stop();
        const latestVersion = await currentVersion('sfb');
        for (const stack of stacks) {
            stack.version = 'none';
            for (const tag of stack.Tags) {
                if (tag.Key === 'version') {
                    stack.version = tag.Value;
                }
            }

            if (stack.version) {
                if (stack.version === latestVersion) {
                    stack.version = chalk.green(stack.version);
                } else {

                    stack.version = chalk.red(stack.version) + " -> "
                        + chalk.green(latestVersion)
                        + " Update: "
                        + (getStageName() === 'stack'
                            ? chalk.yellow(`sfb deploy --region ${stack.region}${stageParam()}${profileParam()}`)
                            : chalk.yellow(`pnpm run dev --region ${stack.region}${stageParam()}${profileParam()}`))
                    ;
                }
            }

            stack.StackStatus = stack.StackStatus.indexOf("COMPLETE") !== -1
                ? chalk.green(stack.StackStatus)
                : chalk.yellow(stack.StackStatus);
        }

        table(stacks, ["region", "StackName", "StackStatus", "version"]);
    });

program
    .command('create')
    .description('Create a task')
    .requiredOption('--name <string>', 'Task name (required)')
    .option('--type <string>', 'Task type')
    .option('--report <boolean>', 'Report')
    .option('--url <string>', 'URL')
    .option('--method <string>', 'Method, default GET')
    .option('--compute <string>', 'Compute Type, default Fargate, others: Lambda, Batch')
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
        await versionCheck();
        await currentRegion();
        if (!task.qps && !task.n) {
            console.error('Error: the --qps or --n option is required');
            process.exit(1);
        }
        if (task.regions) {
            task.regions = task.regions.split(',');
        }
        const res = await invoke('CreateTask', task, 'Task created!');
        await getTask(res.taskId);
    });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
    program.help();
}

async function getTask(taskId) {
    const res = await invoke('taskGetFunction', {taskId}, 'Task Overview:');
    showTask(res);
}

async function getTasks() {
    const res = await invoke('taskListFunction');
    taskList(res.Items);
}

async function credentials() {
    const credentials = fromIni({
            profile: program.opts().profile ? program.opts().profile : 'default'
        }
    );

    return {
        region: program.opts().region,
        credentials,
    };
}

function getStageName() {
    return program.opts().stage ? program.opts().stage : 'stack';
}

async function invoke(name, payload = undefined, tip = 'Completed!') {

    const client = new LambdaClient(await credentials());
    const spinner = ora('Processing...').start();
    const FunctionName = `sfb-${getStageName()}-${name}`;

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

        if (result.success !== true) {
            spinner.fail(chalk.red(JSON.stringify(result, null, 2)));
            process.exit(1);
        }

        if (result.data && result.data.Items && result.data.Items.length === 0) {
            spinner.succeed("No data");
        } else {
            spinner.succeed(chalk.green(tip));
        }

        return result.data;
    } catch (e) {
        const region = await client.config.region();

        if (e.message.indexOf('Function not found') !== -1) {
            spinner.fail('Current region not deployed stack yet, you can:');
            console.log(`    - add ${chalk.yellow('--region <region>')} to specify the region for you command.`);
            console.log(`    - run ${chalk.yellow('sfb deploy')} to deploy the stack.`);
            console.log('    - run ' + chalk.yellow('sfb regions') + ' to show all deployed regions.');
        } else {
            spinner.fail(e.message);
        }

        process.exit(1);
    }

}

async function currentRegion() {
    const spinner = ora('Initializing...').start();
    try {
        const config = await credentials();
        const stsClient = new STSClient(config);
        const region = await stsClient.config.region();

        spinner.info(chalk.bold('Region:  ') + chalk.green(region));
        const command = new GetCallerIdentityCommand({});
        const response = await stsClient.send(command);
        spinner.info(chalk.bold('Account: ') + chalk.green(response.Arn) + '\n');

        return region;
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

    table(data, ["taskId", "name", "type", "region", "status", "startTime", "endTime", "createdAt"]);
}

async function versionCheck() {
    const spinner = ora('Waiting...').start();
    try {
        const response = await axios.get('https://registry.npmjs.org/sfb');
        const serverVersion = response.data['dist-tags'].latest;
        if (serverVersion !== program.version()) {
            spinner.stop();
            console.log(chalk.yellow(`Version ${chalk.bold(chalk.green(serverVersion))} is available. Your version is ${chalk.bold(chalk.red(program.version()))}`));
            console.log(chalk.yellow(`Please update by run: ${chalk.bold(chalk.green('npm i -g sfb'))}\n`));
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
    table(list, ["status", "jobUrl"]);
    console.log(
        "Refresh Task Status: "
        + chalk.yellow(`sfb ls ${res.taskId}${regionParam()}${stageParam()}${profileParam()}`)
    );
}

function regionParam() {
    return program.opts().region ? ` --region ${program.opts().region}` : ""
}

function stageParam() {
    return program.opts().stage ? ` --stage ${program.opts().stage}` : ""
}

function profileParam() {
    return program.opts().profile ? ` --profile ${program.opts().profile}` : ""
}
