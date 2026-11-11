import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

async function runner(t) {
  const root = await mkdtemp(join(tmpdir(), 'upload runner '));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['benchmark/config', 'benchmark/src', 'api', 'bin']) await mkdir(join(root, directory), { recursive: true });
  for (const name of ['cli.mjs', 'runner.mjs', 'evaluate.mjs', 'storage-settings.mjs', 'docker.mjs']) await copyFile(new URL(`../src/${name}`, import.meta.url), join(root, 'benchmark/src', name));
  await copyFile(new URL('../run.sh', import.meta.url), join(root, 'benchmark/run.sh'));
  await copyFile(new URL('../config/protocol.json', import.meta.url), join(root, 'benchmark/config/protocol.json'));
  const mock = join(root, 'bin/mock.cjs');
  await writeFile(mock, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RUNNER_LOG, JSON.stringify({ command, args, scenario: process.env.SCENARIO, name: process.env.RUN_LABEL }) + '\\n');
if (process.env.FAIL_COMMAND === command) process.exit(7);
if (command === 'git' && args[0] === 'rev-parse') console.log('fixture-head');
if (command === 'docker' && args.includes('logs') && process.env.HOLD_LOGS) setTimeout(() => {}, 1000);
if (command === 'docker' && args.includes('run')) {
  if (process.env.HOLD_GENERATOR) setInterval(() => {}, 1000);
  else {
    const directory = path.join('.local/upload-benchmark', process.env.RUN_LABEL);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'summary.json'), '{"verified":true}');
  }
}
`, { mode: 0o755 });
  for (const command of ['docker', 'git', 'tar']) await symlink(mock, join(root, 'bin', command));
  await symlink(mock, join(root, 'api/gradlew'));
  const preload = join(root, 'fetch.mjs');
  await writeFile(preload, `globalThis.fetch = async url => {
    if (url !== 'http://localhost:18080/api/actuator/health') throw new Error('Unexpected request');
    return new Response('{}');
  };`);
  const log = join(root, 'calls.jsonl');
  const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, RUNNER_LOG: log, BENCHMARK_MINIO_COMPRESSION: 'off', BENCHMARK_MINIO_GOMAXPROCS: '', FAIL_COMMAND: '', HOLD_GENERATOR: '', HOLD_LOGS: '' };
  const commandArgs = ['--import', preload, join(root, 'benchmark/src/cli.mjs')];
  return {
    root, env, commandArgs,
    run: (...args) => spawnSync(process.execPath, [...commandArgs, ...args], { cwd: tmpdir(), encoding: 'utf8', env }),
    calls: async () => {
      try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
  };
}

test('help and list explain the CLI without building or touching Docker', async t => {
  const cli = await runner(t);
  for (const args of [[], ['--help'], ['run', '--help'], ['compare', '--help']]) {
    const result = cli.run(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
  }
  const result = cli.run('list');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /quick\s+120s measured/);
  assert.match(result.stdout, /slow\s+60s measured/);
  assert.deepEqual(await cli.calls(), []);
});

test('invalid commands, scenarios, options and names fail before resource operations', async t => {
  const cli = await runner(t);
  for (const args of [['missing'], ['run', '--scenario', 'missing'], ['run', '--name', '../outside'], ['run', '--name', ''], ['run', 'quick'], ['stop', '--scenario', 'quick'], ['run', '--unknown'], ['compare']]) {
    const result = cli.run(...args);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.trim(), 'Expected an actionable error');
  }
  assert.deepEqual(await cli.calls(), []);
});

test('stop only removes this benchmark Compose project', async t => {
  const cli = await runner(t);
  assert.equal(cli.run('stop').status, 0);
  assert.deepEqual(await cli.calls(), [{ command: 'docker', args: ['compose', '-f', 'benchmark/docker/compose.yaml', 'down', '--volumes', '--remove-orphans'] }]);
});

test('runs generate distinct names and print usable result paths', async t => {
  const cli = await runner(t);
  const names = [];
  for (const args of [['run'], ['run'], ['run', '--scenario', 'quick']]) {
    const result = cli.run(...args);
    assert.equal(result.status, 0, result.stderr);
    const path = result.stdout.match(/Results: (.+)\n/)?.[1];
    assert.ok(path, result.stdout);
    assert.deepEqual(JSON.parse(await readFile(join(path, 'summary.json'), 'utf8')), { verified: true });
    names.push(basename(path));
  }
  assert.equal(new Set(names).size, 3);
  const uploads = (await cli.calls()).filter(call => call.command === 'docker' && call.args.includes('run'));
  assert.deepEqual(uploads.map(call => call.scenario), ['smoke', 'smoke', 'quick']);
  assert.deepEqual(uploads.map(call => call.name), names);
});

test('custom names preserve existing results and failed setup cannot reuse a name', async t => {
  const cli = await runner(t);
  assert.equal(cli.run('run', '--scenario', 'quick', '--name', 'baseline-1').status, 0);
  const calls = await cli.calls();
  const result = cli.run('run', '--name', 'baseline-1');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already used.*baseline-1/);
  assert.deepEqual(await cli.calls(), calls);
  assert.equal(await readFile(join(cli.root, '.local/upload-benchmark/baseline-1/summary.json'), 'utf8'), '{"verified":true}');
  cli.env.FAIL_COMMAND = 'gradlew';
  assert.equal(cli.run('run', '--name', 'failed-setup').status, 7);
  const failedCalls = await cli.calls();
  assert.notEqual(cli.run('run', '--name', 'failed-setup').status, 0);
  assert.deepEqual(await cli.calls(), failedCalls);
  assert.ok(failedCalls.some(call => call.command === 'docker' && call.args.includes('logs')));
});

test('compare resolves run names and paths and preserves evaluator reports and verdicts', async t => {
  const cli = await runner(t);
  const directories = [];
  for (let i = 1; i <= 6; i++) {
    const directory = join(cli.root, '.local/upload-benchmark', `run-${i}`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'summary.json'), '{}');
    await writeFile(join(directory, 'operations.jsonl'), '');
    directories.push(directory);
  }
  const output = join(cli.root, 'comparison.json');
  const result = cli.run('compare', '--baseline', 'run-1,run-2,run-3', '--candidate', directories.slice(3).join(','), '--output', output);
  assert.equal(result.status, 1);
  assert.ok(result.stdout, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verdict, 'reject');
  assert.ok(report.reasons.some(reason => reason.includes('Storage')));
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), report);
  assert.deepEqual(await cli.calls(), []);
});

for (const phase of ['generator', 'logs']) {
  test(`SIGTERM during ${phase} preserves logs and interruption status`, async t => {
    const cli = await runner(t);
    const child = spawn(process.execPath, [...cli.commandArgs, 'run', '--name', 'interrupted'], { env: { ...cli.env, HOLD_GENERATOR: phase === 'generator' ? '1' : '', HOLD_LOGS: phase === 'logs' ? '1' : '' }, stdio: 'ignore' });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    const completed = new Promise(accept => child.on('close', (code, signal) => accept({ code, signal })));
    let started = false;
    for (let i = 0; i < 200; i++) {
      if ((await cli.calls()).some(call => call.command === 'docker' && call.args.includes(phase === 'generator' ? 'run' : 'logs'))) { started = true; break; }
      await sleep(25);
    }
    assert.ok(started, `${phase} did not start`);
    child.kill('SIGTERM');
    assert.deepEqual(await completed, { code: 143, signal: null });
    assert.ok((await cli.calls()).some(call => call.command === 'docker' && call.args.includes('logs')));
    await readFile(join(cli.root, '.local/upload-benchmark/interrupted-services.log'));
  });
}

test('historical shell invocations forward to the Node runner', async t => {
  const cli = await runner(t);
  const result = spawnSync('bash', [join(cli.root, 'benchmark/run.sh'), 'quick', 'legacy'], { encoding: 'utf8', env: { ...cli.env, NODE_OPTIONS: `--import=${JSON.stringify(join(cli.root, 'fetch.mjs'))}` } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(cli.root, '.local/upload-benchmark/legacy/summary.json'), 'utf8')), { verified: true });
});
