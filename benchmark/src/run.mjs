import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, stat, access } from 'node:fs/promises';
import { createReadStream, createWriteStream, openSync, writeSync, closeSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixtures, random } from './fixtures.mjs';
import { containers, docker, sample } from './docker.mjs';
import { removeFixture } from './storage.mjs';
import { distribution } from './evaluate.mjs';
import { captureStorageSettings, storageTrial, validateStorageRecord } from './storage-settings.mjs';
import { compressionProbe } from './compression-probe.mjs';
import { waitForDrain } from './drain.mjs';
import { protocolSources } from './protocol-sources.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const protocol = JSON.parse(await readFile('config/protocol.json', 'utf8'));
const reference = JSON.parse(await readFile('config/image-reference.json', 'utf8'));
const evaluatorSources = await protocolSources('.');
const scenarioName = process.env.SCENARIO ?? 'smoke';
const scenario = protocol.scenarios[scenarioName];
if (!scenario) throw new Error(`Unknown scenario ${scenarioName}`);
const label = process.env.RUN_LABEL ?? `${scenarioName}-${Date.now()}`;
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Invalid run label');
const directory = `/results/${label}`;
try { await access(directory); throw new Error(`Run directory already exists: ${directory}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(directory, { recursive: true });
const manifest = await fixtures(protocol, 'public/fixtures');
await writeFile(`${directory}/fixtures.json`, JSON.stringify(manifest, null, 2));
await writeFile(`${directory}/protocol.json`, JSON.stringify(protocol, null, 2));
let selected = manifest;
if (scenario.fixtures) selected = manifest.filter(fixture => scenario.fixtures.includes(fixture.name));
if (process.env.COHORT) {
  selected = manifest.filter(fixture => fixture.cohort === process.env.COHORT || fixture.name === process.env.COHORT);
  if (!selected.length) throw new Error(`Unknown cohort ${process.env.COHORT}`);
}
const cohortSuffix = process.env.COHORT ? `:${process.env.COHORT}` : '';
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:5173');
  let path = url.pathname === '/' ? 'public/index.html' : `public${url.pathname}`;
  if (url.pathname === '/app') path = 'public/app.html';
  if (url.pathname.includes('..')) { response.writeHead(400).end(); return; }
  try {
    const info = await stat(path);
    const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'no-store' });
    await pipeline(createReadStream(path), response);
  } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
});
await writeFile('public/index.html', '<!doctype html><html><body><p>Upload benchmark</p><script src="/browser.js"></script></body></html>');
await writeFile('public/app.html', '<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
await new Promise(resolve => server.listen(5173, '0.0.0.0', resolve));
if (process.env.MODE === 'serve') await new Promise(() => {});
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pages = [];
const browserSamples = [];
const resourceStream = createWriteStream(`${directory}/resources.jsonl`);
const operationStream = createWriteStream(`${directory}/operations.jsonl`);
const traceStream = createWriteStream(`${directory}/traces.jsonl`);
const lifecycleStream = createWriteStream(`${directory}/lifecycle.jsonl`);
const dispatchFile = openSync(`${directory}/dispatches.jsonl`, 'wx');
const diagnostics = [];
let monitoring = false;
let monitorTask;
try {
  for (let i = 0; i < protocol.browserPages; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://localhost:5173');
    await page.evaluate(manifest => window.benchmark.prepare(manifest), manifest);
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    if (scenario.network || (scenario.slowEvery && i === protocol.browserPages - 1)) {
      const network = scenario.network ?? protocol.faultClientNetwork;
      await session.send('Network.enable');
      await session.send('Network.emulateNetworkConditions', { offline: false, latency: network.latencyMs, uploadThroughput: network.uploadBytesPerSecond, downloadThroughput: network.downloadBytesPerSecond });
    }
    pages.push({ page, session });
  }
  const services = await containers();
  const info = await docker('/info');
  const settings = [];
  for (const service of services) {
    const inspect = await docker(`/containers/${service.id}/json`);
    settings.push({ service: service.service, cpus: inspect.HostConfig.NanoCpus, memory: inspect.HostConfig.Memory, image: ['api', 'document-worker', 'image-worker', 'generator'].includes(service.service) ? 'candidate' : service.image });
  }
  settings.sort((a, b) => a.service.localeCompare(b.service));
  const storageMode = process.env.BENCHMARK_MINIO_COMPRESSION ?? 'off';
  const runtimeMode = process.env.BENCHMARK_MINIO_GOMAXPROCS || 'host';
  const minio = services.find(service => service.service === 'minio');
  if (!minio) throw new Error('Benchmark storage container is missing');
  const storageBefore = await captureStorageSettings(minio.id, directory, 'before', storageMode, runtimeMode);
  const storageProbe = await compressionProbe({ containerId: minio.id, directory, mode: storageMode });
  const environment = { cpuCount: info.NCPU, memory: info.MemTotal, kernel: info.KernelVersion, architecture: info.Architecture, settings, chromium: browser.version(), node: process.version, clientDependencies: hash(await readFile('/src/package-lock.json', 'utf8')), storageTrial, storageVersions: { server: storageBefore.serverVersion, mc: storageBefore.mcVersion }, documentStorage: storageBefore.documentStorage };
  const baselineState = { services, environment, storageBefore, storageProbe, scenario: scenarioName + cohortSuffix, slowControlMs: Number(process.env.SLOW_CONTROL_MS ?? 0), runLabel: label };
  await writeFile(`${directory}/environment.json`, JSON.stringify(baselineState, null, 2));
  if (process.env.MODE === 'reference') {
    const captured = {};
    for (const fixture of manifest.filter(fixture => fixture.format)) {
      const result = await pages[0].page.evaluate(input => window.benchmark.run(input), { id: `reference-${fixture.name}`, fixture: fixture.name, captureReference: true, timeoutMs: protocol.operationTimeoutMs });
      if (result.outcome !== 'success') throw new Error(`Reference failed: ${JSON.stringify(result)}`);
      captured[fixture.name] = result.referenceVariants;
      for (const url of result.cleanupUrls) await removeFixture(url);
    }
    await writeFile(`${directory}/image-reference.json`, JSON.stringify(captured, null, 2));
    console.log(`Captured references in ${directory}/image-reference.json`);
    process.exitCode = 0;
    await browser.close();
    server.close();
    for (const stream of [resourceStream, operationStream, traceStream, lifecycleStream]) stream.end();
    closeSync(dispatchFile);
    process.exit(0);
  }
  const next = random(protocol.seed);
  function choose() {
    let target = next() * selected.reduce((sum, fixture) => sum + fixture.weight, 0);
    return selected.find(fixture => (target -= fixture.weight) < 0) ?? selected.at(-1);
  }
  let serial = 0;
  const pending = new Map();
  const completed = [];
  const terminalIds = new Set();
  let cleanupFailures = 0;
  let cleanupObjects = 0;
  function record(result) {
    if (terminalIds.has(result.id)) return;
    terminalIds.add(result.id);
    completed.push(result);
    operationStream.write(`${JSON.stringify(result)}\n`);
  }
  async function offer(plan, measured, faults = {}) {
    const { fixture } = plan;
    const { id, scheduledMs, ordinal } = plan;
    const startMs = Date.now();
    const faultPlan = faults.cancel ? 'cancel' : faults.interrupt ? 'interrupt' : faults.retry ? 'retry' : faults.slow ? 'slow' : 'normal';
    const base = { id, fixture: fixture.name, cohort: fixture.name, bytes: fixture.bytes, scheduledMs, startMs, generatorLagMs: Math.max(0, startMs - scheduledMs), timeoutMs: protocol.operationTimeoutMs, sampled: ordinal % protocol.traceEvery === 0, slowControlMs: measured ? Number(process.env.SLOW_CONTROL_MS ?? 0) : 0, reference: reference[fixture.name], faultPlan, ...faults };
    if (measured) writeSync(dispatchFile, `${JSON.stringify({ id, scheduledMs, startMs, cohort: fixture.name, faultPlan })}\n`);
    if (pending.size >= protocol.maxInflight) {
      const result = { ...base, outcome: 'rejected', endMs: startMs, error: 'Generator inflight capacity reached' };
      if (measured) record(result);
      return;
    }
    const target = scenario.slowEvery ? pages[(faults.slow || faults.interrupt || faults.cancel) ? pages.length - 1 : ordinal % (pages.length - 1)] : pages[ordinal % pages.length];
    const lifecycle = { id, scheduledMs, admittedMs: Date.now(), cleanupObjects: 0 };
    const task = (async () => {
      let result;
      try { result = await target.page.evaluate(input => window.benchmark.run(input), base); }
      catch (error) { result = { ...base, outcome: 'error', endMs: Date.now(), error: error.message }; }
      lifecycle.resultReceivedMs = Date.now();
      lifecycle.clientEndMs = result.endMs;
      if (result.outcome === 'expected_fault') result.expectedFault = result.injected;
      result.generatorLagMs = Math.max(0, result.startMs - scheduledMs);
      if (result.sampled) traceStream.write(`${JSON.stringify({ id, sessionId: result.sessionId, assetId: result.assetId, spans: result.spans })}\n`);
      delete result.spans;
      delete result.reference;
      delete result.referenceVariants;
      const cleanupUrls = result.cleanupUrls ?? [];
      delete result.cleanupUrls;
      if (measured) record(result);
      lifecycle.cleanupStartedMs = Date.now();
      for (const url of cleanupUrls) {
        try { await removeFixture(url); cleanupObjects++; lifecycle.cleanupObjects++; }
        catch (error) { cleanupFailures++; diagnostics.push(error.message); }
      }
      lifecycle.cleanupFinishedMs = Date.now();
    })().finally(() => {
      pending.delete(id);
      lifecycle.slotReleasedMs = Date.now();
      if (measured) lifecycleStream.write(`${JSON.stringify(lifecycle)}\n`);
    });
    pending.set(id, { task, base, measured });
  }
  async function arrivals(segments, measured) {
    const start = Date.now();
    let cumulativeSeconds = 0;
    const schedule = [];
    for (const segment of segments) {
      const dt = 0.001;
      let mass = 0;
      for (let t = 0; t < segment.seconds; t += dt) {
        mass += (segment.from + (segment.to - segment.from) * t / segment.seconds) * dt;
        while (mass >= 1) { schedule.push(start + Math.round((cumulativeSeconds + t) * 1000)); mass--; }
      }
      cumulativeSeconds += segment.seconds;
    }
    const plans = schedule.map((scheduledMs, index) => {
      const ordinal = index + 1;
      const faults = measured ? { slow: Boolean(scenario.slowEvery && ordinal % scenario.slowEvery === 0), interrupt: Boolean(scenario.interruptEvery && ordinal % scenario.interruptEvery === 0), cancel: Boolean(scenario.cancelEvery && ordinal % scenario.cancelEvery === 0), retry: Boolean(scenario.retryEvery && ordinal % scenario.retryEvery === 0) } : {};
      const chosen = choose();
      const fixture = faults.interrupt || faults.cancel ? manifest.find(fixture => fixture.name === 'text-boundary-above.bin') : chosen;
      return { scheduledMs, fixture, faults, id: `${measured ? 'op' : 'warm'}-${serial}`, ordinal: serial++ };
    });
    if (measured) await writeFile(`${directory}/offered.jsonl`, plans.map(plan => JSON.stringify({ ...plan, fixture: plan.fixture.name, cohort: plan.fixture.name, bytes: plan.fixture.bytes })).join('\n') + '\n');
    const jobs = plans.map((plan, index) => (async () => {
      const { scheduledMs } = plan;
      while (Date.now() < scheduledMs) await sleep(Math.max(1, scheduledMs - Date.now()));
      void offer(plan, measured, plan.faults);
    })());
    const restarts = measured ? (scenario.restartAtSeconds ?? []).map(seconds => (async () => {
      await sleep(seconds * 1000);
      for (const service of services.filter(service => ['image-worker', 'document-worker'].includes(service.service))) await docker(`/containers/${service.id}/restart?t=1`, 'POST');
      resourceStream.write(`${JSON.stringify({ type: 'restart', at: Date.now() })}\n`);
    })()) : [];
    await Promise.all([...jobs, ...restarts]);
    await sleep(Math.max(0, start + cumulativeSeconds * 1000 - Date.now()));
    return { start, end: start + cumulativeSeconds * 1000, offered: schedule.length };
  }
  async function drain() {
    return waitForDrain(async () => {
      if (pending.size) return false;
      const [queues, durable] = await Promise.all([queue(), durableBacklog()]);
      return queues.every(item => item.messages === 0) && durable.outbox === 0 && durable.preparing === 0 && durable.incomplete === 0;
    }, protocol.drainSeconds * 1000);
  }
  async function queue() {
    const response = await fetch('http://rabbitmq:15672/api/queues/file_upload', { headers: { Authorization: `Basic ${Buffer.from('file_upload:file_upload').toString('base64')}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Queue inspection returned ${response.status}`);
    const data = await response.json();
    return data.map(item => ({ name: item.name, messages: item.messages ?? 0, ready: item.messages_ready ?? 0, unacked: item.messages_unacknowledged ?? 0, headTimestamp: item.head_message_timestamp ?? null }));
  }
  async function durableBacklog() {
    const response = await fetch('http://api:8080/api/actuator/prometheus', { headers: { Authorization: `Basic ${Buffer.from('metrics:metrics-local').toString('base64')}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Durable backlog inspection returned ${response.status}`);
    const body = await response.text();
    const result = {};
    for (const [field, metric] of Object.entries({ outbox: 'file_upload_outbox_pending', preparing: 'file_upload_preparing', incomplete: 'file_upload_incomplete', outboxOldestAgeSeconds: 'file_upload_outbox_oldest_age_seconds' })) {
      const match = body.match(new RegExp(`^${metric} ([0-9.eE+-]+)$`, 'm'));
      if (!match) throw new Error(`Missing durable backlog metric ${metric}`);
      result[field] = Number(match[1]);
    }
    return result;
  }
  await arrivals([{ seconds: scenario.warmupSeconds ?? protocol.warmupSeconds, from: scenario.warmupRate ?? 2, to: scenario.warmupRate ?? 2 }], false);
  if (!await drain()) throw new Error('Warmup did not drain');
  const initialQueues = await queue();
  if (initialQueues.some(item => item.messages !== 0)) throw new Error('Starting queues are not empty');
  const initialDurableBacklog = await durableBacklog();
  if (initialDurableBacklog.outbox || initialDurableBacklog.preparing || initialDurableBacklog.incomplete) throw new Error('Starting durable backlog is not empty');
  const resourceSamples = [];
  const pressureSamples = [];
  let queuePeak = 0;
  let queueAgePeakSeconds = 0;
  async function monitor() {
    const samples = await Promise.all(services.map(service => sample(service).catch(error => { diagnostics.push(error.message); return null; })));
    for (const entry of samples.filter(Boolean)) { resourceSamples.push(entry); resourceStream.write(`${JSON.stringify(entry)}\n`); }
    try {
      const queues = await queue();
      const durable = await durableBacklog();
      queuePeak = Math.max(queuePeak, queues.reduce((sum, item) => sum + item.messages, 0));
      for (const item of queues) if (item.headTimestamp) queueAgePeakSeconds = Math.max(queueAgePeakSeconds, Date.now() / 1000 - item.headTimestamp);
      resourceStream.write(`${JSON.stringify({ type: 'queues', at: Date.now(), queues })}\n`);
      const pressure = { at: Date.now(), inflight: pending.size, messages: queues.reduce((sum, item) => sum + item.messages, 0), ...durable };
      pressureSamples.push(pressure);
      resourceStream.write(`${JSON.stringify({ type: 'backlog', ...pressure })}\n`);
    } catch (error) { diagnostics.push(error.message); }
    for (let i = 0; i < pages.length; i++) {
      const metrics = await pages[i].session.send('Performance.getMetrics');
      const putMetrics = await pages[i].page.evaluate(() => window.benchmark.putMetrics());
      const values = Object.fromEntries(metrics.metrics.map(metric => [metric.name, metric.value]));
      const entry = { type: 'browser', at: Date.now(), page: i, jsHeapUsedBytes: values.JSHeapUsedSize, taskSeconds: values.TaskDuration, ...putMetrics };
      browserSamples.push(entry);
      resourceStream.write(`${JSON.stringify(entry)}\n`);
    }
  }
  for (const { page } of pages) await page.evaluate(() => window.benchmark.putMetrics(true));
  await monitor();
  monitoring = true;
  monitorTask = (async () => { while (monitoring) { await sleep(protocol.sampleIntervalMs); if (monitoring) await monitor(); } })();
  const measurement = await arrivals(scenario.segments, true);
  const drained = await drain();
  if (!drained) for (const { base, measured } of pending.values()) if (measured) record({ ...base, outcome: 'unfinished', endMs: Date.now() });
  await monitor();
  monitoring = false;
  await monitorTask;
  const finalQueues = await queue();
  const finalDurableBacklog = await durableBacklog();
  const storageAfter = await captureStorageSettings(minio.id, directory, 'after', storageMode, runtimeMode);
  const storageConfig = { mode: storageMode, runtimeMode, before: storageBefore, after: storageAfter };
  validateStorageRecord(storageConfig);
  if (storageBefore.documentStorageHash !== storageAfter.documentStorageHash) throw new Error('Document bucket configuration changed during measurement');
  const recoveries = [...(scenario.recoveryAtSeconds ?? []), ...(scenario.restartAtSeconds ?? [])].map(seconds => {
    const at = measurement.start + seconds * 1000;
    const before = pressureSamples.filter(sample => sample.at >= at - protocol.recovery.baselineWindowSeconds * 1000 && sample.at < at);
    const limits = Object.fromEntries(['inflight', 'messages', 'outbox', 'preparing'].map(field => [field, before.length ? [...before.map(sample => sample[field])].sort((a, b) => a - b)[Math.ceil(before.length * 0.95) - 1] : 0]));
    let stableSince = null;
    let recoveredAt = null;
    for (const sample of pressureSamples.filter(sample => sample.at >= at)) {
      if (Object.entries(limits).every(([field, limit]) => sample[field] <= limit)) {
        stableSince ??= sample.at;
        if (sample.at - stableSince >= protocol.recovery.stableSeconds * 1000) { recoveredAt = stableSince; break; }
      } else stableSince = null;
    }
    return { atSeconds: seconds, limits, recoveryMs: recoveredAt === null ? null : recoveredAt - at };
  });
  const resources = {};
  for (const service of services) {
    const values = resourceSamples.filter(sample => sample.service === service.service);
    if (!values.length) continue;
    const result = {};
    for (const field of ['cpuSeconds', 'networkRxBytes', 'networkTxBytes', 'storageReadBytes', 'storageWriteBytes', 'throttledSeconds']) {
      let delta = 0;
      for (let i = 1; i < values.length; i++) delta += Math.max(0, values[i][field] - values[i - 1][field]);
      result[field] = delta;
    }
    result.peakMemoryBytes = values.reduce((peak, value) => Math.max(peak, value.peakMemoryBytes), 0);
    if (values.every(value => Number.isFinite(value.anonymousMemoryBytes))) result.peakAnonymousMemoryBytes = values.reduce((peak, value) => Math.max(peak, value.anonymousMemoryBytes), 0);
    resources[service.service] = result;
  }
  const summary = {
    scenario: scenarioName + cohortSuffix, protocolHash: hash(evaluatorSources), fixtureHash: hash(manifest), environmentHash: hash(environment),
    storageConfig, storageProbe,
    network: scenario.network ?? null,
    networkEmulation: scenario.network ? 'CDP Network.emulateNetworkConditions, per-page aggregate rates, enabled after fixture preparation' : null,
    offered: measurement.offered, recorded: completed.length, measurementStartMs: measurement.start, measurementEndMs: measurement.end,
    drained: drained && finalQueues.every(item => item.messages === 0) && finalDurableBacklog.outbox === 0 && finalDurableBacklog.preparing === 0 && finalDurableBacklog.incomplete === 0,
    durableBacklogDrained: finalDurableBacklog.outbox === 0 && finalDurableBacklog.preparing === 0 && finalDurableBacklog.incomplete === 0,
    unfinishedServerUploads: finalDurableBacklog.incomplete,
    measurementCoverageComplete: services.every(service => resourceSamples.filter(sample => sample.service === service.service).length >= 2) && diagnostics.length === 0,
    resources, queuePeak, queueAgePeakSeconds,
    recoveryMs: recoveries.some(event => event.recoveryMs === null) ? protocol.drainSeconds * 1000 + scenario.segments.reduce((sum, segment) => sum + segment.seconds, 0) * 1000 : Math.max(0, ...recoveries.map(event => event.recoveryMs)),
    recoveries, allRecovered: recoveries.every(event => event.recoveryMs !== null), finalDrainObservedMs: Math.max(0, Date.now() - measurement.end), initialQueues, finalQueues, initialDurableBacklog, finalDurableBacklog,
    outcomes: completed.reduce((counts, operation) => ({ ...counts, [operation.outcome]: (counts[operation.outcome] ?? 0) + 1 }), {}),
    readyMs: distribution(completed.filter(operation => operation.outcome === 'success').map(operation => operation.readyMs - operation.scheduledMs)),
    downloadableMs: distribution(completed.filter(operation => operation.outcome === 'success').map(operation => operation.endMs - operation.scheduledMs)),
    clientJsHeapPeakBytes: browserSamples.reduce((peak, sample) => Math.max(peak, sample.jsHeapUsedBytes ?? 0), 0),
    clientPutConcurrencyPeak: browserSamples.reduce((peak, sample) => Math.max(peak, sample.peakActivePuts ?? 0), 0),
    cleanupFailures, cleanupObjects, diagnostics,
    clientTasksUnsettledAtReturn: completed.filter(operation => operation.clientTaskSettled === false).length,
    clientPutsActiveAtReturn: completed.reduce((sum, operation) => sum + (operation.activePutsAtReturn ?? 0), 0),
    resourceEvidence: { peakMemory: 'one-second requested samples, includes page cache', generatorNetwork: 'isolated Docker bridge counters', queueAge: finalQueues.some(queue => queue.headTimestamp !== null) ? 'broker timestamp' : 'unavailable' },
    limitations: ['clientTaskSettled covers upload and download verification; production uploadFile does not consume signal, and the cancellation send guard covers requests associated before route teardown', 'Docker storage counters may omit cached/overlay writes; zero is not proof of no physical I/O', 'Memory sampling can miss transient peaks; actual sample cadence is archived', 'Queue head age is unavailable when the broker omits head_message_timestamp', 'Cleanup removes verified benchmark objects; production retention is unverified', 'Marginal p99 intervals assume independent samples; correlated queueing can widen uncertainty', 'Worker restart counter resets can omit CPU/IO between the final pre-stop sample and termination'],
  };
  await writeFile(`${directory}/summary.json`, JSON.stringify(summary, null, 2));
  const prometheus = await fetch(`http://prometheus:9090/api/v1/query?query=${encodeURIComponent('up')}`);
  await writeFile(`${directory}/prometheus-up.json`, await prometheus.text());
  const range = new URL('http://prometheus:9090/api/v1/query_range');
  range.searchParams.set('query', '{__name__=~"file_upload_.*|process_cpu_seconds_total|process_resident_memory_bytes|go_memstats_heap_alloc_bytes|rabbitmq_queue_messages.*"}');
  range.searchParams.set('start', String(measurement.start / 1000));
  range.searchParams.set('end', String(Date.now() / 1000));
  range.searchParams.set('step', '2');
  const metrics = await fetch(range);
  await writeFile(`${directory}/prometheus-series.json`, await metrics.text());
  await pages[0].page.screenshot({ path: `${directory}/browser.png` });
  console.log(JSON.stringify({ directory, offered: summary.offered, recorded: summary.recorded, outcomes: summary.outcomes, readyP99: summary.readyMs.p99, downloadableP99: summary.downloadableMs.p99, drained: summary.drained, cleanupFailures, diagnostics }));
  if (summary.recorded !== summary.offered || !summary.drained || cleanupFailures || diagnostics.length || completed.some(operation => ['error', 'timeout', 'unfinished'].includes(operation.outcome))) process.exitCode = 1;
} finally {
  monitoring = false;
  if (monitorTask) await monitorTask.catch(() => {});
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const stream of [resourceStream, operationStream, traceStream, lifecycleStream]) await new Promise(resolve => stream.end(resolve));
  closeSync(dispatchFile);
}
