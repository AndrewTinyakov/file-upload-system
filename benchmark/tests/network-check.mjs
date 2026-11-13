import http from 'node:http';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const rate = 128 * 1024;
const size = 128 * 1024;
const latencyMs = 100;
const bytes = Buffer.from(Array.from({length: size}, (_, index) => (index * 37 + 11) % 256));
const expectedHash = createHash('sha256').update(bytes).digest('hex');
const requests = [];
const server = http.createServer(async (req, res) => {
  const started = performance.now();
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>CDP network validation</title>');
    return;
  }
  if (req.url.startsWith('/tiny')) {
    res.end('ok');
    return;
  }
  if (req.method === 'PUT') {
    const chunks = [];
    const arrivals = [];
    for await (const chunk of req) {
      chunks.push(chunk);
      arrivals.push({bytes: chunk.length, ms: performance.now() - started});
    }
    const body = Buffer.concat(chunks);
    const hash = createHash('sha256').update(body).digest('hex');
    requests.push({url: req.url, method: req.method, bytes: body.length, hash, ms: performance.now() - started, arrivals});
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({bytes: body.length, hash}));
    return;
  }
  requests.push({url: req.url, method: req.method, bytes: bytes.length, hash: expectedHash});
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', bytes.length);
  res.end(bytes);
});
let browser;
const deadline = setTimeout(() => {
  console.error('Validation exceeded 30 seconds');
  browser?.close().finally(() => server.closeAllConnections());
  process.exitCode = 1;
}, 30_000);

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const conditions = {offline: false, latency: latencyMs, downloadThroughput: rate, uploadThroughput: rate, connectionType: 'wifi'};
  async function tiny() {
    return page.evaluate(async () => {
      const start = performance.now();
      await (await fetch(`/tiny?${Math.random()}`)).text();
      return performance.now() - start;
    });
  }
  const baselineLatency = [];
  for (let index = 0; index < 3; index++) baselineLatency.push(await tiny());
  await cdp.send('Network.emulateNetworkConditions', conditions);
  const throttledLatency = [];
  for (let index = 0; index < 3; index++) throttledLatency.push(await tiny());
  const batches = [];
  for (const method of ['PUT', 'GET']) {
    for (const count of [1, 2]) {
      const result = await page.evaluate(async ({method, count, size}) => {
        const started = performance.now();
        const transfer = index => new Promise((resolve, reject) => {
          const data = new Uint8Array(size);
          for (let offset = 0; offset < size; offset++) data[offset] = (offset * 37 + 11) % 256;
          const xhr = new XMLHttpRequest();
          const progress = [];
          const uploadProgress = [];
          xhr.open(method, `/payload/${method}/${count}/${index}?${Math.random()}`);
          xhr.timeout = 12_000;
          xhr.responseType = method === 'GET' ? 'arraybuffer' : 'text';
          xhr.onprogress = event => progress.push({bytes: event.loaded, ms: performance.now() - started});
          xhr.upload.onprogress = event => uploadProgress.push({bytes: event.loaded, ms: performance.now() - started});
          xhr.onerror = () => reject(new Error('XHR network error'));
          xhr.ontimeout = () => reject(new Error('XHR timeout'));
          xhr.onload = async () => {
            if (xhr.status !== 200) return reject(new Error(`HTTP ${xhr.status}`));
            if (method === 'PUT') {
              resolve({ms: performance.now() - started, ...JSON.parse(xhr.response), progress, uploadProgress});
            } else {
              const digest = await crypto.subtle.digest('SHA-256', xhr.response);
              const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
              resolve({ms: performance.now() - started, bytes: xhr.response.byteLength, hash, progress, uploadProgress});
            }
          };
          xhr.send(method === 'PUT' ? data : null);
        });
        const transfers = await Promise.all(Array.from({length: count}, (_, index) => transfer(index)));
        return {method, count, ms: performance.now() - started, transfers};
      }, {method, count, size});
      result.aggregateKiBPerSecond = count * size / 1024 / (result.ms / 1000);
      result.latencyAdjustedKiBPerSecond = count * size / 1024 / ((result.ms - latencyMs) / 1000);
      result.byteExact = result.transfers.every(transfer => transfer.bytes === size && transfer.hash === expectedHash);
      batches.push(result);
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const latencyDeltaMs = median(throttledLatency) - median(baselineLatency);
  const directions = ['PUT', 'GET'].map(method => {
    const single = batches.find(batch => batch.method === method && batch.count === 1);
    const concurrent = batches.find(batch => batch.method === method && batch.count === 2);
    const durationRatio = concurrent.ms / single.ms;
    const ratePass = [single, concurrent].every(batch => batch.latencyAdjustedKiBPerSecond >= 96 && batch.latencyAdjustedKiBPerSecond <= 160);
    return {method, durationRatio, ratePass, sharedAggregatePass: durationRatio >= 1.55 && durationRatio <= 2.5, byteExactPass: single.byteExact && concurrent.byteExact};
  });
  const result = {
    timestamp: new Date().toISOString(),
    command: 'docker compose -f benchmark/docker/compose.yaml run --rm --no-deps --entrypoint node generator /bench/tests/network-check.mjs',
    sourceSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    browser: await browser.version(), conditions, size, expectedHash,
    latency: {baselineMs: baselineLatency, throttledMs: throttledLatency, medianDeltaMs: latencyDeltaMs, pass: latencyDeltaMs >= 75 && latencyDeltaMs <= 180},
    directions, batches, requests,
    limits: ['CDP session targets one page and its requests; separate browser contexts require their own sessions.', 'Rates are browser-emulated bytes per second, not host or container traffic shaping.', 'XHR upload progress reports browser scheduling and can differ from server receipt timing.', 'This checks localhost HTTP/1.1 payload transport and does not establish application or HTTP/2 behavior.'],
    pass: latencyDeltaMs >= 75 && latencyDeltaMs <= 180 && directions.every(item => item.ratePass && item.sharedAggregatePass && item.byteExactPass),
  };
  await writeFile(process.env.NETWORK_CHECK_OUTPUT ?? '/results/network-check.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
