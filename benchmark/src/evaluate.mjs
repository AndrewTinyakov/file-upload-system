import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateStorageRecord } from './storage-settings.mjs';

const outcomes = ['success', 'expected_fault', 'error', 'timeout', 'rejected', 'unfinished'];
const resourceFields = ['cpuSeconds', 'peakMemoryBytes', 'networkRxBytes', 'networkTxBytes', 'storageReadBytes', 'storageWriteBytes'];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const median = values => nearestRank(values, 0.5);
const spread = values => Math.max(...values) - Math.min(...values);

export function nearestRank(values, probability) {
  if (!values.length || probability <= 0 || probability > 1) throw new Error('A nonempty sample and probability in (0, 1] are required');
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * probability) - 1];
}

export function quantileInterval(values, probability, confidence = 0.95) {
  const ordered = [...values].sort((a, b) => a - b);
  const n = ordered.length;
  if (!n || probability <= 0 || probability >= 1 || confidence <= 0 || confidence >= 1) throw new Error('Invalid quantile interval parameters');
  const mode = Math.floor((n + 1) * probability);
  const weights = new Float64Array(n + 1);
  weights[mode] = 1;
  for (let k = mode; k > 0; k--) weights[k - 1] = weights[k] * k / (n - k + 1) * (1 - probability) / probability;
  for (let k = mode; k < n; k++) weights[k + 1] = weights[k] * (n - k) / (k + 1) * probability / (1 - probability);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const tail = (1 - confidence) / 2;
  let cumulative = 0;
  let lowerRank;
  let upperRank;
  for (let k = 0; k <= n; k++) {
    cumulative += weights[k] / total;
    if (lowerRank === undefined && cumulative >= tail) lowerRank = k;
    if (cumulative >= 1 - tail) {
      upperRank = k + 1;
      break;
    }
  }
  return {
    confidence,
    lowerRank,
    upperRank,
    lower: lowerRank > 0 ? ordered[lowerRank - 1] : null,
    upper: upperRank <= n ? ordered[upperRank - 1] : null,
    bounded: lowerRank > 0 && upperRank <= n,
  };
}

export function distribution(values) {
  if (!values.length) return { count: 0, histogramResolutionMs: 1, histogram: [], p95: null, p99: null };
  const bins = new Map();
  for (const value of values) {
    const bucket = Math.round(value);
    bins.set(bucket, (bins.get(bucket) ?? 0) + 1);
  }
  return {
    count: values.length,
    histogramResolutionMs: 1,
    histogram: [...bins].sort((a, b) => a[0] - b[0]).map(([ms, count]) => ({ ms, count })),
    p95: { value: nearestRank(values, 0.95), interval: quantileInterval(values, 0.95) },
    p99: { value: nearestRank(values, 0.99), interval: quantileInterval(values, 0.99) },
  };
}

function validateRun(run, label) {
  const errors = [];
  const fail = message => errors.push(`${label}: ${message}`);
  const summary = run?.summary;
  if (!summary || !Array.isArray(run.operations)) return [`${label}: summary and operations are required`];
  try { validateStorageRecord(summary.storageConfig); } catch (error) { fail(error.message); }
  if (summary.storageProbe?.verified !== true || summary.storageProbe?.mode !== summary.storageConfig?.mode) fail('Storage compatibility preflight is missing or failed');
  for (const field of ['scenario', 'protocolHash', 'fixtureHash', 'environmentHash']) {
    if (typeof summary[field] !== 'string' || !summary[field].trim()) fail(`invalid ${field}`);
  }
  if (!Number.isSafeInteger(summary.offered) || summary.offered < 0 || summary.offered !== run.operations.length) fail('offered operation accounting mismatch');
  if (!finite(summary.measurementStartMs) || !finite(summary.measurementEndMs) || summary.measurementEndMs <= summary.measurementStartMs) fail('invalid measurement window');
  if (summary.drained !== true) fail('run did not drain');
  if (summary.cleanupFailures > 0) fail('fixture cleanup failed');
  if (Array.isArray(summary.diagnostics) && summary.diagnostics.length) fail('measurement diagnostics are not empty');
  if (summary.measurementCoverageComplete === false) fail('resource measurement coverage is incomplete');
  if (summary.durableBacklogDrained === false) fail('durable outbox or preparation did not drain');
  if (summary.allRecovered === false) fail('load or restart recovery did not complete');
  const services = summary.resources;
  if (!services || typeof services !== 'object' || Array.isArray(services) || !Object.keys(services).length) fail('service resource counters are required');
  else for (const [service, resources] of Object.entries(services)) {
    if (!resources || resourceFields.some(field => !finite(resources[field]))) fail(`invalid resource counters for ${service}`);
    if (resources?.peakAnonymousMemoryBytes !== undefined && !finite(resources.peakAnonymousMemoryBytes)) fail(`invalid anonymous memory for ${service}`);
  }
  for (const field of ['recoveryMs', 'queuePeak', 'queueAgePeakSeconds']) {
    if (summary[field] !== undefined && !finite(summary[field])) fail(`invalid ${field}`);
  }
  const ids = new Set();
  for (const [index, operation] of run.operations.entries()) {
    const prefix = `operation ${index}`;
    if (!operation || typeof operation !== 'object') { fail(`${prefix} is invalid`); continue; }
    if ((typeof operation.id !== 'string' && typeof operation.id !== 'number') || String(operation.id).length === 0 || (typeof operation.id === 'number' && !Number.isSafeInteger(operation.id))) fail(`${prefix} has invalid id`);
    if (ids.has(String(operation.id))) fail(`${prefix} has duplicate id`);
    ids.add(String(operation.id));
    if (typeof operation.cohort !== 'string' || !operation.cohort) fail(`${prefix} has invalid cohort`);
    if (!outcomes.includes(operation.outcome)) fail(`${prefix} has invalid outcome`);
    if (operation.outcome === 'unfinished') fail(`${prefix} did not finish`);
    if (operation.outcome === 'expected_fault' && !operation.expectedFault) fail(`${prefix} expected fault lacks declaration`);
    if (operation.outcome === 'expected_fault' && (!operation.abortObserved || !operation.serverAbortObserved || !operation.injected || !(operation.interrupt || operation.cancel) || !finite(operation.interruptedBytes) || operation.interruptedBytes <= 0)) fail(`${prefix} expected fault lacks observed injection and server abort`);
    if (['interrupt', 'cancel'].includes(operation.faultPlan) && operation.outcome !== 'expected_fault') fail(`${prefix} planned abort did not produce its required observed outcome`);
    if (operation.faultPlan === 'retry' && (operation.retries < 1 || operation.injected !== 'lost-complete-response' || operation.outcome !== 'success')) fail(`${prefix} retry did not recover the lost completion response`);
    for (const field of ['scheduledMs', 'startMs', 'endMs', 'bytes', 'generatorLagMs']) {
      if (!finite(operation[field])) fail(`${prefix} has invalid ${field}`);
    }
    if (!Number.isSafeInteger(operation.bytes)) fail(`${prefix} has invalid byte count`);
    if (operation.startMs < operation.scheduledMs || operation.endMs < operation.startMs) fail(`${prefix} has nonmonotonic timestamps`);
    if (operation.scheduledMs < summary.measurementStartMs || operation.scheduledMs >= summary.measurementEndMs) fail(`${prefix} was offered outside the measurement window`);
    if (operation.readyMs !== undefined && (!finite(operation.readyMs) || operation.readyMs < operation.startMs || operation.readyMs > operation.endMs)) fail(`${prefix} has invalid readyMs`);
    if (operation.retries !== undefined && (!Number.isSafeInteger(operation.retries) || operation.retries < 0)) fail(`${prefix} has invalid retries`);
    if (operation.stageMs !== undefined && (!operation.stageMs || typeof operation.stageMs !== 'object' || Array.isArray(operation.stageMs) || Object.values(operation.stageMs).some(value => !finite(value)))) fail(`${prefix} has invalid stage timings`);
  }
  return errors;
}

function groupRun(run, cohort) {
  const operations = cohort === null ? run.operations : run.operations.filter(operation => operation.cohort === cohort);
  const counts = Object.fromEntries(outcomes.map(outcome => [outcome, 0]));
  for (const operation of operations) counts[operation.outcome]++;
  const successes = operations.filter(operation => operation.outcome === 'success');
  const successfulBytes = successes.reduce((sum, operation) => sum + operation.bytes, 0);
  const seconds = (run.summary.measurementEndMs - run.summary.measurementStartMs) / 1000;
  const terminalMs = operations.reduce((latest, operation) => Math.max(latest, operation.endMs), run.summary.measurementEndMs);
  const observedSeconds = (terminalMs - run.summary.measurementStartMs) / 1000;
  const ready = successes.map(operation => (operation.readyMs ?? operation.endMs) - operation.scheduledMs);
  const end = successes.map(operation => operation.endMs - operation.scheduledMs);
  const lag = operations.map(operation => operation.generatorLagMs);
  const metrics = {
    errorFraction: operations.length ? (operations.length - counts.success - counts.expected_fault) / operations.length : 0,
    successfulFilesPerSecond: successes.length / observedSeconds,
    successfulBytesPerSecond: successfulBytes / observedSeconds,
    generatorLagP95Ms: lag.length ? nearestRank(lag, 0.95) : 0,
    generatorLagP99Ms: lag.length ? nearestRank(lag, 0.99) : 0,
    readyP95Ms: ready.length ? nearestRank(ready, 0.95) : null,
    readyP99Ms: ready.length ? nearestRank(ready, 0.99) : null,
    endP95Ms: end.length ? nearestRank(end, 0.95) : null,
    endP99Ms: end.length ? nearestRank(end, 0.99) : null,
  };
  if (cohort === null && successes.length) {
    let totalCpu = 0;
    for (const [service, resource] of Object.entries(run.summary.resources)) {
      totalCpu += resource.cpuSeconds;
      metrics[`service.${service}.cpuSecondsPerSuccess`] = resource.cpuSeconds / successes.length;
      metrics[`service.${service}.peakMemoryBytes`] = resource.peakMemoryBytes;
      if (resource.peakAnonymousMemoryBytes !== undefined) metrics[`service.${service}.peakAnonymousMemoryBytes`] = resource.peakAnonymousMemoryBytes;
      for (const field of resourceFields.slice(2)) metrics[`service.${service}.${field}PerSuccessfulByte`] = successfulBytes ? resource[field] / successfulBytes : null;
    }
    metrics.cpuSecondsPerSuccess = totalCpu / successes.length;
    for (const field of ['recoveryMs', 'queuePeak', 'queueAgePeakSeconds']) {
      if (run.summary[field] !== undefined) metrics[field] = run.summary[field];
    }
  }
  return { offered: operations.length, counts, successfulBytes, measurementSeconds: seconds, observedSeconds, metrics, ready, end, lag };
}

function combineGroups(groups) {
  return {
    offered: groups.reduce((sum, group) => sum + group.offered, 0),
    counts: Object.fromEntries(outcomes.map(outcome => [outcome, groups.reduce((sum, group) => sum + group.counts[outcome], 0)])),
    scheduledToReadyOrEndMs: distribution(groups.flatMap(group => group.ready)),
    scheduledToEndMs: distribution(groups.flatMap(group => group.end)),
    generatorLagMs: distribution(groups.flatMap(group => group.lag)),
    runs: groups.map(({ ready, end, lag, ...rest }) => rest),
  };
}

function guardMetric(name, baseline, candidate) {
  const higherIsBetter = name === 'successfulFilesPerSecond' || name === 'successfulBytesPerSecond';
  const allowance = spread(baseline);
  const limit = higherIsBetter ? Math.min(...baseline) - allowance : Math.max(...baseline) + allowance;
  const candidateWorst = higherIsBetter ? Math.min(...candidate) : Math.max(...candidate);
  return { metric: name, direction: higherIsBetter ? 'higher' : 'lower', baselineMedian: median(baseline), baselineRange: [Math.min(...baseline), Math.max(...baseline)], allowance, limit, candidateWorst, pass: higherIsBetter ? candidateWorst >= limit : candidateWorst <= limit };
}

export function evaluate(baselineRuns, candidateRuns) {
  const invalid = [];
  const evidence = [];
  const groups = {};
  if (!Array.isArray(baselineRuns) || !Array.isArray(candidateRuns) || !baselineRuns.length || !candidateRuns.length) return { verdict: 'reject', reasons: ['Both baseline and candidate runs are required'], groups };
  for (const [side, runs] of [['baseline', baselineRuns], ['candidate', candidateRuns]]) {
    if (runs.length < 3) evidence.push(`${side} needs at least three independent runs`);
    for (const [index, run] of runs.entries()) invalid.push(...validateRun(run, `${side}[${index}]`));
  }
  if (invalid.length) return { verdict: 'reject', reasons: invalid, groups };
  const allRuns = [...baselineRuns, ...candidateRuns];
  const reference = baselineRuns[0].summary;
  for (const runs of [baselineRuns, candidateRuns]) if (runs.some(run => run.summary.storageConfig.mode !== runs[0].summary.storageConfig.mode)) invalid.push('Storage trial settings differ within a comparison side');
  for (const runs of [baselineRuns, candidateRuns]) if (runs.some(run => run.summary.storageConfig.runtimeMode !== runs[0].summary.storageConfig.runtimeMode)) invalid.push('Storage runtime trial settings differ within a comparison side');
  for (const field of ['numCpu', 'goVersion']) if (allRuns.some(run => run.summary.storageConfig.before.runtime[field] !== reference.storageConfig.before.runtime[field])) invalid.push(`Storage runtime ${field} differs across runs`);
  for (const field of ['scenario', 'protocolHash', 'fixtureHash', 'environmentHash']) {
    if (allRuns.some(run => run.summary[field] !== reference[field])) invalid.push(`Mismatched evaluation ${field}`);
  }
  const serviceNames = Object.keys(reference.resources).sort().join('\0');
  if (allRuns.some(run => Object.keys(run.summary.resources).sort().join('\0') !== serviceNames)) invalid.push('Service resource counter sets differ');
  for (const field of ['recoveryMs', 'queuePeak', 'queueAgePeakSeconds']) {
    const presence = allRuns.map(run => run.summary[field] !== undefined);
    if (presence.some(Boolean) && !presence.every(Boolean)) invalid.push(`Missing comparable ${field}`);
  }
  const cohorts = [...new Set(allRuns.flatMap(run => run.operations.map(operation => operation.cohort)))].sort();
  for (const cohort of cohorts) {
    if (allRuns.some(run => !run.operations.some(operation => operation.cohort === cohort))) invalid.push(`Missing cohort ${cohort} in a run`);
  }
  if (invalid.length) return { verdict: 'reject', reasons: invalid, groups };
  const failed = [];
  let resourceImproved = false;
  let p99Improved = false;
  for (const cohort of [null, ...cohorts]) {
    const name = cohort === null ? 'global' : `cohort:${cohort}`;
    const baseline = baselineRuns.map(run => groupRun(run, cohort));
    const candidate = candidateRuns.map(run => groupRun(run, cohort));
    const baselineCombined = combineGroups(baseline);
    const candidateCombined = combineGroups(candidate);
    const guards = [];
    const metricNames = new Set([...baseline, ...candidate].flatMap(group => Object.keys(group.metrics)));
    for (const metric of metricNames) {
      const b = baseline.map(group => group.metrics[metric]);
      const c = candidate.map(group => group.metrics[metric]);
      if ([...b, ...c].some(value => !finite(value))) { evidence.push(`${name}: ${metric} has no measurable denominator or successful sample`); continue; }
      const guard = guardMetric(metric, b, c);
      guards.push(guard);
      if (!guard.pass) failed.push(`${name}: ${metric} regressed beyond baseline spread`);
      if (cohort === null && (metric.endsWith('cpuSecondsPerSuccess') || metric.endsWith('PerSuccessfulByte')) && Math.max(...c) + spread(b) < Math.min(...b)) resourceImproved = true;
    }
    for (const [side, combined] of [['baseline', baselineCombined], ['candidate', candidateCombined]]) {
      if (combined.counts.success < 1000) evidence.push(`${name}: ${side} needs at least 1000 successful operations`);
    }
    const readySpread = spread(baseline.map(group => group.metrics.readyP99Ms));
    const endSpread = spread(baseline.map(group => group.metrics.endP99Ms));
    const readyBaselineInterval = baselineCombined.scheduledToReadyOrEndMs.p99?.interval;
    const readyCandidateInterval = candidateCombined.scheduledToReadyOrEndMs.p99?.interval;
    const endBaselineInterval = baselineCombined.scheduledToEndMs.p99?.interval;
    const endCandidateInterval = candidateCombined.scheduledToEndMs.p99?.interval;
    const readyImproved = readyBaselineInterval?.bounded && readyCandidateInterval?.bounded && readyCandidateInterval.upper + readySpread < readyBaselineInterval.lower;
    const endImproved = endBaselineInterval?.bounded && endCandidateInterval?.bounded && endCandidateInterval.upper + endSpread < endBaselineInterval.lower;
    if (cohort === null) p99Improved = readyImproved && endImproved;
    groups[name] = { baseline: baselineCombined, candidate: candidateCombined, guards, p99Improvement: { scheduledToReadyOrEnd: Boolean(readyImproved), scheduledToEnd: Boolean(endImproved), baselineReadySpreadMs: readySpread, baselineEndSpreadMs: endSpread } };
  }
  if (!p99Improved) evidence.push('Global p99 improvement does not exceed baseline spread and disjoint 95% quantile intervals');
  if (!resourceImproved) evidence.push('No CPU or network/storage cost improvement exceeds baseline run-to-run spread');
  return {
    verdict: failed.length ? 'reject' : evidence.length ? 'insufficient_evidence' : 'accept',
    reasons: failed.length ? [...failed, ...evidence] : evidence,
    comparison: Object.fromEntries(['scenario', 'protocolHash', 'fixtureHash', 'environmentHash'].map(field => [field, reference[field]])),
    storageSettings: { baseline: baselineRuns[0].summary.storageConfig.before.effective, candidate: candidateRuns[0].summary.storageConfig.before.effective },
    storageRuntimeSettings: { baseline: baselineRuns[0].summary.storageConfig.before.runtime, candidate: candidateRuns[0].summary.storageConfig.before.runtime },
    method: { quantiles: 'Exact nearest rank on unrounded observations', intervals: 'Equal-tail 95% binomial order-statistic intervals, mode-centered probability recurrence', intervalAssumptions: 'Marginal intervals assume independent observations; no simultaneous familywise coverage or proof of independent physical runs', allowance: 'Baseline maximum minus minimum, applied beyond the observed baseline range to every candidate run', throughput: 'Successes divided by time from measurement start through the later of measurement end and terminal completion', resourceAttribution: 'Run-level service counters; cohort guards cover latency, errors, throughput and generator lag', minimumSuccessesPerGroup: 1000, minimumRunsPerSide: 3, improvement: 'Both global p99 endpoints must have disjoint intervals beyond baseline spread; at least one resource cost must improve in every candidate run beyond baseline spread' },
    groups,
  };
}

export async function loadRuns(directories) {
  const paths = await Promise.all(directories.map(directory => realpath(directory)));
  if (new Set(paths).size !== paths.length) throw new Error('Run directories must be distinct');
  return Promise.all(paths.map(async directory => {
    const [summary, lines] = await Promise.all([readFile(resolve(directory, 'summary.json'), 'utf8'), readFile(resolve(directory, 'operations.jsonl'), 'utf8')]);
    return { directory, summary: JSON.parse(summary), operations: lines.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)) };
  }));
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--baseline', '--candidate', '--output'].includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error('Usage: node benchmark/src/evaluate.mjs --baseline run1,run2,run3 --candidate run4,run5,run6 [--output report.json]');
    options[args[index]] = args[index + 1];
  }
  if (!options['--baseline'] || !options['--candidate']) throw new Error('--baseline and --candidate are required');
  const baselineDirectories = options['--baseline'].split(',').map(path => path.trim());
  const candidateDirectories = options['--candidate'].split(',').map(path => path.trim());
  if ([...baselineDirectories, ...candidateDirectories].some(path => !path)) throw new Error('Empty run directory');
  const runs = await loadRuns([...baselineDirectories, ...candidateDirectories]);
  const report = evaluate(runs.slice(0, baselineDirectories.length), runs.slice(baselineDirectories.length));
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options['--output']) await writeFile(options['--output'], json);
  process.stdout.write(json);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await main();
    process.exitCode = report.verdict === 'accept' ? 0 : report.verdict === 'insufficient_evidence' ? 2 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ verdict: 'reject', reasons: [error.message] }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
