import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { distribution, evaluate, loadRuns, nearestRank, quantileInterval } from '../src/evaluate.mjs';
import { storageHash, storageTrial } from '../src/storage-settings.mjs';

function storageConfig(mode = 'off', runtimeMode = 'host') {
  const effective = { enable: mode, ...storageTrial.fixed };
  const names = { enable: 'ENABLE', allow_encryption: 'ALLOW_ENCRYPTION', extensions: 'EXTENSIONS', mime_types: 'MIME_TYPES' };
  const kv = Object.entries(effective).map(([key, value]) => ({ key, value, envOverride: { name: `MINIO_COMPRESSION_${names[key]}`, value } }));
  const snapshot = { containerId: 'minio', startedAt: '2026-11-08T00:00:00Z', image: 'image', serverVersion: 'minio-pinned', mcVersion: 'mc-pinned', effective, hash: storageHash(effective), config: { status: 'success', config: [{ subSystem: 'compression', kv }] }, environment: kv.map(entry => `${entry.envOverride.name}=${entry.envOverride.value}`) };
  snapshot.runtimeEnvironment = [`GOMAXPROCS=${runtimeMode === 'host' ? '' : runtimeMode}`];
  snapshot.runtimeInfo = { status: 'success', info: { servers: [{ go_max_procs: runtimeMode === 'host' ? 11 : 2, num_cpu: 11, runtime_version: 'go1.24.6' }] } };
  snapshot.runtime = { mode: runtimeMode, gomaxprocs: runtimeMode === 'host' ? 11 : 2, numCpu: 11, goVersion: 'go1.24.6', environment: snapshot.runtimeEnvironment };
  return { mode, runtimeMode, before: structuredClone(snapshot), after: structuredClone(snapshot) };
}

function run({ latency = 100, cpu = 100, count = 1200, slowCohortLatency, hash = 'protocol', offset = 0 } = {}) {
  const operations = Array.from({ length: count }, (_, index) => {
    const cohort = index < count / 2 ? 'small' : 'large';
    const elapsed = cohort === 'large' && slowCohortLatency !== undefined ? slowCohortLatency : latency;
    return { id: String(index), cohort, scheduledMs: index, startMs: index + 1, endMs: index + elapsed + offset, readyMs: index + elapsed + offset, bytes: 1024, outcome: 'success', generatorLagMs: 1 };
  });
  return {
    summary: { scenario: 'upload', protocolHash: hash, fixtureHash: 'fixtures', environmentHash: 'environment', storageConfig: storageConfig(), storageProbe: { verified: true, mode: 'off' }, offered: count, measurementStartMs: 0, measurementEndMs: 10000, drained: true, resources: { api: { cpuSeconds: cpu, peakMemoryBytes: 1024, networkRxBytes: 1024 * count, networkTxBytes: 1024 * count, storageReadBytes: 0, storageWriteBytes: 1024 * count } } },
    operations,
  };
}

const runs = options => [0, 1, 2].map(offset => run({ count: 2400, ...options, offset }));

test('declared storage trial differs across sides while missing or drifting settings reject comparison', () => {
  const baseline = runs();
  const candidate = runs({ latency: 60, cpu: 60 });
  for (const entry of candidate) {
    entry.summary.storageConfig = storageConfig('on');
    entry.summary.storageProbe.mode = 'on';
  }
  assert.equal(evaluate(baseline, candidate).verdict, 'accept');
  for (const mutate of [
    summary => { delete summary.storageConfig; },
    summary => { summary.storageConfig.after.startedAt = 'changed'; },
    summary => { summary.storageConfig.after.effective.enable = 'off'; },
    summary => { summary.storageConfig.before.environment.push('MINIO_COMPRESS=off'); },
    summary => { summary.storageConfig = storageConfig('off'); },
    summary => { summary.storageProbe.verified = false; },
  ]) {
    const changed = structuredClone(candidate);
    mutate(changed[0].summary);
    assert.equal(evaluate(baseline, changed).verdict, 'reject');
  }
});

test('nearest-rank percentiles stay exact while histogram rounds to one millisecond', () => {
  assert.equal(nearestRank([1, 2, 3, 4], 0.95), 4);
  const result = distribution([1.2, 1.4, 2.7]);
  assert.equal(result.p99.value, 2.7);
  assert.equal(result.count, 3);
  assert.equal(result.histogramResolutionMs, 1);
  assert.deepEqual(result.histogram, [{ ms: 1, count: 2 }, { ms: 3, count: 1 }]);
});

test('binomial order-statistic interval agrees with a worked Bernoulli example', () => {
  assert.deepEqual(quantileInterval([1, 2, 3, 4, 5], 0.5), { confidence: 0.95, lowerRank: 0, upperRank: 6, lower: null, upper: null, bounded: false });
  const interval = quantileInterval([1, 2, 3, 4, 5, 6], 0.5);
  assert.equal(interval.lower, 1);
  assert.equal(interval.upper, 6);
  assert.equal(interval.bounded, true);
});

test('matched baseline is insufficient and real tail plus resource improvement is accepted', () => {
  const baseline = runs();
  assert.equal(evaluate(baseline, structuredClone(baseline)).verdict, 'insufficient_evidence');
  const result = evaluate(baseline, runs({ latency: 60, cpu: 60 }));
  assert.equal(result.verdict, 'accept', result.reasons.join('\n'));
  assert.equal(result.groups.global.baseline.counts.success, 7200);
  assert.equal(result.groups['cohort:small'].candidate.scheduledToEndMs.count, 3600);
});

test('slower candidate fails tail guards', () => {
  const result = evaluate(runs(), runs({ latency: 150, cpu: 60 }));
  assert.equal(result.verdict, 'reject');
  assert.ok(result.reasons.some(reason => reason.includes('readyP99Ms regressed')));
});

test('invalid sampling, cleanup, recovery, and unobserved faults cannot pass', () => {
  for (const failure of [{ diagnostics: ['Docker request timeout'] }, { cleanupFailures: 100 }, { measurementCoverageComplete: false }, { durableBacklogDrained: false }, { allRecovered: false }]) {
    const candidate = runs({ latency: 60, cpu: 60 });
    Object.assign(candidate[0].summary, failure);
    assert.equal(evaluate(runs(), candidate).verdict, 'reject');
  }
  const candidate = runs({ latency: 60, cpu: 60 });
  Object.assign(candidate[0].operations[0], { outcome: 'expected_fault', expectedFault: 'cancel' });
  assert.equal(evaluate(runs(), candidate).verdict, 'reject');
});

test('cohort regression is rejected even when aggregate p99 improves', () => {
  const baseline = runs({ latency: 200, slowCohortLatency: 50 });
  const candidate = runs({ latency: 100, slowCohortLatency: 100, cpu: 60 });
  const result = evaluate(baseline, candidate);
  assert.equal(result.groups.global.p99Improvement.scheduledToEnd, true);
  assert.equal(result.verdict, 'reject');
  assert.ok(result.reasons.some(reason => reason.includes('cohort:large: readyP99Ms')));
});

test('every offered operation must have a unique accounted terminal record', () => {
  const candidate = runs({ latency: 60, cpu: 60 });
  candidate[0].operations.pop();
  assert.match(evaluate(runs(), candidate).reasons.join('\n'), /accounting mismatch/);
  const duplicate = runs({ latency: 60, cpu: 60 });
  duplicate[0].operations[1].id = duplicate[0].operations[0].id;
  assert.match(evaluate(runs(), duplicate).reasons.join('\n'), /duplicate id/);
  const unfinished = runs({ latency: 60, cpu: 60 });
  unfinished[0].operations[0].outcome = 'unfinished';
  assert.match(evaluate(runs(), unfinished).reasons.join('\n'), /did not finish/);
});

test('underpowered cohorts and fewer than three runs yield insufficient evidence', () => {
  const baseline = [run({ count: 200 }), run({ count: 200 }), run({ count: 200 })];
  const candidate = [run({ count: 200, latency: 60, cpu: 60 }), run({ count: 200, latency: 60, cpu: 60 }), run({ count: 200, latency: 60, cpu: 60 })];
  assert.equal(evaluate(baseline, candidate).verdict, 'insufficient_evidence');
  assert.equal(evaluate(runs().slice(0, 2), runs({ latency: 60, cpu: 60 }).slice(0, 2)).verdict, 'insufficient_evidence');
});

test('mismatched evaluation hashes reject comparison', () => {
  for (const field of ['scenario', 'protocolHash', 'fixtureHash', 'environmentHash']) {
    const candidate = runs({ latency: 60, cpu: 60 });
    candidate[0].summary[field] = 'different';
    const result = evaluate(runs(), candidate);
    assert.equal(result.verdict, 'reject');
    assert.ok(result.reasons.includes(`Mismatched evaluation ${field}`));
  }
});

test('expected faults remain separately accounted and unexpected failures guard errors', () => {
  const baseline = runs();
  const candidate = runs({ latency: 60, cpu: 60 });
  for (const group of [baseline, candidate]) for (const entry of group) {
    entry.operations[0].outcome = 'expected_fault';
    entry.operations[0].expectedFault = 'injected failure';
    Object.assign(entry.operations[0], { abortObserved: true, serverAbortObserved: true, injected: 'cancel', cancel: true, interruptedBytes: 100 });
  }
  const accepted = evaluate(baseline, candidate);
  assert.equal(accepted.verdict, 'accept', accepted.reasons.join('\n'));
  assert.equal(accepted.groups.global.candidate.counts.expected_fault, 3);
  candidate[0].operations[1].outcome = 'timeout';
  const rejected = evaluate(baseline, candidate);
  assert.equal(rejected.verdict, 'reject');
  assert.ok(rejected.reasons.some(reason => reason.includes('errorFraction')));
});

test('resource, generator lag, recovery, and drain guards reject regressions', () => {
  for (const mutation of [
    entry => { entry.summary.resources.api.peakMemoryBytes *= 2; },
    entry => { entry.summary.resources.api.networkRxBytes *= 2; },
    entry => { entry.summary.resources.api.cpuSeconds *= 10; },
    entry => { for (const operation of entry.operations) operation.generatorLagMs = 20; },
    entry => { entry.summary.recoveryMs = 200; },
    entry => { entry.summary.drained = false; },
  ]) {
    const baseline = runs();
    const candidate = runs({ latency: 60, cpu: 60 });
    for (const entry of [...baseline, ...candidate]) entry.summary.recoveryMs = 100;
    mutation(candidate[0]);
    assert.equal(evaluate(baseline, candidate).verdict, 'reject');
  }
});

test('downloads use scheduled-to-end latency and include generator delay', () => {
  const baseline = runs();
  const candidate = runs({ latency: 60, cpu: 60 });
  for (const entry of [...baseline, ...candidate]) for (const operation of entry.operations) delete operation.readyMs;
  const result = evaluate(baseline, candidate);
  assert.equal(result.verdict, 'accept');
  assert.equal(result.groups.global.candidate.scheduledToEndMs.p99.value, 62);
});

test('directory CLI produces an accepted report and rejects reused directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'benchmark-evaluator-'));
  try {
    const paths = [];
    for (const [index, entry] of [...runs(), ...runs({ latency: 60, cpu: 60 })].entries()) {
      const directory = join(root, String(index));
      await mkdir(directory);
      await Promise.all([writeFile(join(directory, 'summary.json'), JSON.stringify(entry.summary)), writeFile(join(directory, 'operations.jsonl'), entry.operations.map(operation => JSON.stringify(operation)).join('\n'))]);
      paths.push(directory);
    }
    const result = spawnSync(process.execPath, ['benchmark/src/evaluate.mjs', '--baseline', paths.slice(0, 3).join(','), '--candidate', paths.slice(3).join(',')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).verdict, 'accept');
    await assert.rejects(loadRuns([paths[0], paths[0]]), /distinct/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime trials allow distinct matched sides but reject mixed settings within either side', () => {
  const baseline = runs();
  const candidate = runs({ latency: 60, cpu: 60 });
  for (const entry of candidate) entry.summary.storageConfig = storageConfig('off', '2');
  assert.equal(evaluate(baseline, candidate).verdict, 'accept');
  for (const side of ['baseline', 'candidate']) {
    const b = structuredClone(baseline), c = structuredClone(candidate);
    (side === 'baseline' ? b : c)[0].summary.storageConfig = storageConfig('off', side === 'baseline' ? '2' : 'host');
    assert.match(evaluate(b, c).reasons.join('\n'), /runtime trial settings differ/);
  }
});

test('fixed runtime provenance cannot drift between otherwise valid runs', () => {
  for (const field of ['numCpu', 'goVersion']) {
    const baseline = runs(), candidate = runs({ latency: 60, cpu: 60 });
    for (const entry of candidate) entry.summary.storageConfig = storageConfig('off', '2');
    for (const phase of ['before', 'after']) {
      const snapshot = candidate[0].summary.storageConfig[phase];
      const value = field === 'numCpu' ? 7 : 'go1.99.1';
      snapshot.runtime[field] = value;
      snapshot.runtimeInfo.info.servers[0][field === 'numCpu' ? 'num_cpu' : 'runtime_version'] = value;
    }
    assert.match(evaluate(baseline, candidate).reasons.join('\n'), /differs across runs/);
  }
});
