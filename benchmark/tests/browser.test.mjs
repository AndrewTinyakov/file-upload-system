import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';

const source = await readFile(new URL('../src/browser.ts', import.meta.url), 'utf8');
const bundle = await build({ stdin: { contents: source, loader: 'ts', resolveDir: '/bench' }, bundle: true, write: false, format: 'iife', plugins: [{ name: 'client-boundary', setup(builder) {
  builder.onResolve({ filter: /^\/src\// }, args => ({ path: args.path, namespace: 'boundary' }));
  builder.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ contents: args.path.endsWith('/upload')
    ? 'export const getUserId=()=>"owner"; export const uploadFile=options=>window.testUpload(options);'
    : 'export const OpenAPI={}; export const UploadSessionControllerService={abort:(owner,id)=>window.fetch("http://api:8080/api/v1/upload-sessions/"+id+"/abort").then(r=>r.json())};' }));
} }] });

async function runAbort(stall, queued = false) {
  const payload = new Uint8Array([1, 2, 3, 4]);
  const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', payload)).toString('hex');
  const events = new Map();
  let apiAttempts = 0;
  let queuedCancelled = false;
  class Request {
    upload = { addEventListener: (name, callback) => events.set(name, callback) };
    open() {}
    addEventListener(name, callback) { events.set(name, callback); }
    send() { events.get('progress')({ loaded: 1, total: 4 }); }
    abort() { events.get('abort')?.(); this.onabort?.(); }
  }
  const window = { fetch: async (input, options) => {
    if (String(input).startsWith('/fixtures/')) return new Response(payload);
    apiAttempts++;
    if (String(input).endsWith('/abort')) {
      if (!stall) return Response.json({ status: 'ABORTED' });
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
    return Response.json({ sessionId: 'session', assetId: '01ARZ3NDEKTSV4RRFFQ69G5FAW', upload: { url: 'http://minio:9000/uploads/source' } });
  } };
  const sandbox = { window, XMLHttpRequest: Request, performance, AbortSignal, AbortController, Blob, File, Response, URL, crypto: webcrypto, setTimeout, clearTimeout };
  vm.runInNewContext(bundle.outputFiles[0].text, sandbox);
  window.testUpload = async ({ file, signal }) => {
    if (queued) return new Promise((_, reject) => signal.addEventListener('abort', () => {
      queuedCancelled = true;
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true }));
    const response = await window.fetch('http://api:8080/api/v1/upload-sessions', { body: JSON.stringify({ filename: file.name }) });
    const session = await response.json();
    await new Promise((_, reject) => {
      const request = new Request();
      request.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
      request.open('PUT', session.upload.url);
      request.send(file);
    });
  };
  await window.benchmark.prepare([{ name: 'fixture.bin', bytes: 4, sha256: digest, type: 'application/octet-stream' }]);
  const start = performance.now();
  const result = await window.benchmark.run({ id: 'op', fixture: 'fixture.bin', interrupt: !queued, timeoutMs: 30 });
  return { result, elapsed: performance.now() - start, apiAttempts, queuedCancelled };
}

test('an immediately rejected client abort still verifies the server abort', async () => {
  const { result, apiAttempts } = await runAbort(false);
  assert.equal(result.outcome, 'expected_fault');
  assert.equal(result.serverAbortObserved, true);
  assert.equal(result.apiRequests, apiAttempts);
});

test('a stalled server abort retains the original operation deadline', async () => {
  const { result, elapsed, apiAttempts } = await runAbort(true);
  assert.equal(result.outcome, 'timeout');
  assert.ok(elapsed < 1000, `Abort settlement took ${elapsed} ms`);
  assert.equal(result.apiRequests, apiAttempts);
});

test('the operation deadline cancels a client waiting for a transfer slot', async () => {
  const { result, elapsed, apiAttempts, queuedCancelled } = await runAbort(false, true);
  assert.equal(result.outcome, 'timeout');
  assert.equal(queuedCancelled, true);
  assert.equal(apiAttempts, 0);
  assert.ok(elapsed < 500, `Queued cancellation took ${elapsed} ms`);
});
