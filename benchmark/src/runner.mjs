import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, open, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const compose = ['compose', '-f', 'benchmark/docker/compose.yaml'];

export async function scenarios(root) {
  return JSON.parse(await readFile(resolve(root, 'benchmark/config/protocol.json'), 'utf8')).scenarios;
}

async function command(root, executable, args, { output, signal, env = process.env } = {}) {
  const file = output ? await open(output, 'w') : null;
  try {
    await new Promise((accept, reject) => {
      const child = spawn(executable, args, { cwd: root, env, signal, stdio: ['inherit', file?.fd ?? 'inherit', 'inherit'] });
      let failure;
      child.on('error', error => { failure = error; });
      child.on('close', (code, stoppedBy) => {
        if (failure) reject(failure);
        else if (code === 0) accept();
        else reject(Object.assign(new Error(`${executable} failed${stoppedBy ? ` with ${stoppedBy}` : ` with exit code ${code}`}`), { exitCode: code || 1 }));
      });
    });
  } finally {
    await file?.close();
  }
}

export async function stopBenchmark(root) {
  await command(root, 'docker', [...compose, 'down', '--volumes', '--remove-orphans']);
}

async function waitForApi(signal) {
  for (let attempt = 0; attempt < 90; attempt++) {
    signal?.throwIfAborted();
    try {
      const response = await fetch('http://localhost:18080/api/actuator/health', { signal: AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      signal?.throwIfAborted();
    }
    await sleep(2000, undefined, { signal });
  }
  throw new Error('API did not become healthy. Inspect the saved service logs.');
}

export async function runBenchmark(root, { scenario = 'smoke', name, signal } = {}) {
  const profiles = await scenarios(root);
  if (!Object.hasOwn(profiles, scenario)) throw new Error(`Unknown scenario: ${scenario}. Use "list" to see available scenarios.`);
  name ??= `${scenario}-${new Date().toISOString().replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid name. Use letters, numbers, underscores and hyphens.');
  if (!['off', 'on'].includes(process.env.BENCHMARK_MINIO_COMPRESSION ?? 'off')) throw new Error('BENCHMARK_MINIO_COMPRESSION must be off or on.');
  if (!['', '2'].includes(process.env.BENCHMARK_MINIO_GOMAXPROCS ?? '')) throw new Error('BENCHMARK_MINIO_GOMAXPROCS must be unset or 2.');
  const resultsRoot = resolve(root, '.local/upload-benchmark');
  await mkdir(resultsRoot, { recursive: true });
  const files = await readdir(resultsRoot);
  if ([name, `${name}-head.txt`, `${name}-services.log`, `${name}-source.patch`, `${name}-sources.tar.gz`, `${name}-compose.yaml`].some(path => files.includes(path))) {
    throw new Error(`Run name already used: ${name}. Omit --name to generate a new one.`);
  }
  const results = resolve(resultsRoot, name);
  const reservation = await open(`${results}-head.txt`, 'wx');
  await reservation.close();
  process.stdout.write(`Scenario: ${scenario}\nResults: ${results}\n`);
  const exec = (executable, args, options = {}) => command(root, executable, args, { signal, ...options });
  try {
    await access(resolve(root, 'api/gradlew'));
    await exec('./api/gradlew', ['-p', 'api', 'clean', 'bootJar', '--console=plain']);
    await exec('docker', [...compose, 'build', 'api', 'generator', 'document-worker', 'image-worker']);
    await exec('docker', [...compose, 'down', '--volumes', '--remove-orphans']);
    await exec('docker', [...compose, 'up', '-d', 'postgres', 'rabbitmq', 'minio', 'minio-init', 'api', 'document-worker', 'image-worker', 'prometheus', 'grafana']);
    await waitForApi(signal);
    await exec('git', ['rev-parse', 'HEAD'], { output: `${results}-head.txt` });
    await exec('git', ['diff', '--binary', 'HEAD', '--', 'client', 'api', 'workers'], { output: `${results}-source.patch` });
    await exec('tar', ['--exclude=node_modules', '--exclude=build', '--exclude=.gradle', '--exclude=.local', '-czf', `${results}-sources.tar.gz`, 'api/src', 'api/build.gradle.kts', 'client/src', 'client/package.json', 'workers', 'contracts', 'benchmark', 'package.json', 'package-lock.json', 'infra']);
    await exec('docker', [...compose, 'config'], { output: `${results}-compose.yaml` });
    await exec('docker', [...compose, 'run', '--rm', 'generator'], { env: { ...process.env, SCENARIO: scenario, RUN_LABEL: name } });
  } finally {
    try { await command(root, 'docker', [...compose, 'logs', '--no-color'], { output: `${results}-services.log` }); }
    catch (error) { process.stderr.write(`Could not save service logs: ${error.message}\n`); }
  }
  process.stdout.write(`\nResults: ${results}\n`);
  return results;
}
