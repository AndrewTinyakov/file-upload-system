import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';

const source = await readFile(new URL('../src/browser.ts', import.meta.url), 'utf8');
async function browserBundle(realClient = false) {
  return build({ stdin: { contents: source, loader: 'ts', resolveDir: '/bench' }, bundle: true, write: false, format: 'iife', plugins: [{ name: 'client-boundary', setup(builder) {
  builder.onResolve({ filter: /^(\/src\/|\.\/api\/generated$|actual-client$)/ }, args => ({ path: args.path, namespace: 'boundary' }));
  builder.onLoad({ filter: /.*/, namespace: 'boundary' }, async args => {
    if (args.path === 'actual-client') return { contents: await readFile(process.env.BENCHMARK_TEST_CLIENT_SOURCE ?? new URL('../../client/src/upload.ts', import.meta.url), 'utf8'), loader: 'ts' };
    if (realClient && args.path.endsWith('/upload')) return { contents: `
      import {uploadFile as actualUploadFile,getUserId} from 'actual-client';
      export {getUserId};
      export const uploadFile=options=>{
        window.clientSignal=options.signal;
        window.observedClientSettled=false;
        const task=actualUploadFile(options);
        task.then(()=>window.observedClientSettled=true,()=>window.observedClientSettled=true);
        return task;
      };` };
    return { contents: args.path.endsWith('/upload')
    ? 'export const getUserId=()=>"owner"; export const uploadFile=options=>window.testUpload(options);'
    : `export const OpenAPI={};
      export const CreateUploadSessionRequest={handlingMode:{IMAGE:'IMAGE',DOCUMENT:'DOCUMENT'}};
      export const UploadSessionResponse={strategy:{SINGLE:'SINGLE'}};
      export const FileAssetResponse={status:{READY:'READY',FAILED:'FAILED',DISCARDED:'DISCARDED'}};
      export const FileAssetControllerService={};
      export const UploadSessionControllerService={
        create:(owner,key,body)=>window.fetch('http://api:8080/api/v1/upload-sessions',{body:JSON.stringify(body)}).then(r=>r.json()),
        presignParts:(owner,id,body)=>window.fetch('http://api:8080/api/v1/upload-sessions/'+id+'/parts',{body:JSON.stringify(body)}).then(r=>r.json()),
        complete:(owner,id,body)=>window.fetch('http://api:8080/api/v1/upload-sessions/'+id+'/complete',{body:JSON.stringify(body)}).then(r=>r.json()),
        abort:(owner,id)=>window.fetch('http://api:8080/api/v1/upload-sessions/'+id+'/abort').then(r=>r.json())
      };` };
  });
} }] });
}
const bundle = await browserBundle();

async function runAbort(stall, queued = false, realClient = false, { sampled = false, assetId = '01ARZ3NDEKTSV4RRFFQ69G5FAW' } = {}) {
  const payload = new Uint8Array([1, 2, 3, 4]);
  const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', payload)).toString('hex');
  let apiAttempts = 0;
  let queuedCancelled = false;
  let mockClientCalled = false;
  class Request {
    events = new Map();
    upload = { addEventListener: (name, callback) => this.addEventListener(`upload:${name}`, callback) };
    open() {}
    setRequestHeader() {}
    addEventListener(name, callback) { this.events.set(name, [...(this.events.get(name) ?? []), callback]); }
    dispatch(name, event = {}) { for (const callback of this.events.get(name) ?? []) callback(event); this[`on${name}`]?.(event); }
    send() { this.dispatch('upload:progress', { loaded: 1, total: 4 }); }
    abort() { this.dispatch('abort'); this.dispatch('loadend'); }
  }
  const window = { fetch: async (input, options) => {
    if (String(input).startsWith('/fixtures/')) return new Response(payload);
    apiAttempts++;
    if (String(input).endsWith('/abort')) {
      if (!stall) return Response.json({ status: 'ABORTED' });
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
    return Response.json({ sessionId: 'session', assetId, strategy: 'SINGLE', upload: { method: 'PUT', url: 'http://minio:9000/uploads/source', headers: {} } });
  } };
  const sandbox = { window, XMLHttpRequest: Request, performance, AbortSignal, AbortController, DOMException, Blob, File, Response, URL, crypto: webcrypto, setTimeout, clearTimeout, localStorage: { getItem: () => 'owner' } };
  vm.runInNewContext((realClient ? await browserBundle(true) : bundle).outputFiles[0].text, sandbox);
  window.testUpload = async ({ file, signal }) => {
    mockClientCalled = true;
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
  const result = await window.benchmark.run({ id: 'op', fixture: 'fixture.bin', sampled, interrupt: !queued, timeoutMs: 30 });
  return { result, elapsed: performance.now() - start, apiAttempts, queuedCancelled, mockClientCalled, metrics: window.benchmark.putMetrics(), observedClientSettled: window.observedClientSettled, clientSignalAborted: window.clientSignal?.aborted };
}

test('an immediately rejected client abort still verifies the server abort', async () => {
  const { result, apiAttempts } = await runAbort(false);
  assert.equal(result.outcome, 'expected_fault');
  assert.equal(result.serverAbortObserved, true);
  assert.equal(result.apiRequests, apiAttempts);
  assert.equal(result.clientTaskSettled, true);
  assert.equal(result.activePutsAtReturn, 0);
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
  assert.equal(result.clientTaskSettled, true);
  assert.equal(result.activePutsAtReturn, 0);
  assert.ok(elapsed < 500, `Queued cancellation took ${elapsed} ms`);
});

test('native abort reports the real client settlement without changing its semantics', async context => {
  const { result, elapsed, apiAttempts, mockClientCalled, metrics, observedClientSettled, clientSignalAborted } = await runAbort(false, false, true);
  assert.equal(mockClientCalled, false);
  assert.equal(result.outcome, 'expected_fault');
  assert.equal(result.abortObserved, true);
  assert.equal(result.serverAbortObserved, true);
  assert.equal(result.apiRequests, apiAttempts);
  assert.equal(clientSignalAborted, true);
  assert.equal(result.clientTaskSettled, observedClientSettled);
  assert.equal(result.activePutsAtReturn, 0);
  assert.equal(metrics.activePuts, 0);
  assert.ok(elapsed < 1500, `Unsettled client reporting took ${elapsed} ms`);
  context.diagnostic(`Observed real client settled after native abort: ${observedClientSettled}`);
});

test('a real multipart client deadline aborts every started PUT without completing the session', async context => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', payload)).toString('hex');
  const startedRequests = [];
  let completionRequests = 0;
  class Request {
    events = new Map();
    upload = { addEventListener() {} };
    open() {}
    setRequestHeader() {}
    addEventListener(name, callback) { this.events.set(name, [...(this.events.get(name) ?? []), callback]); }
    send() { startedRequests.push(this); }
    abort() {
      if (this.aborted) return;
      this.aborted = true;
      this.onabort?.();
      for (const name of ['abort', 'loadend']) for (const callback of this.events.get(name) ?? []) callback();
    }
  }
  const window = { fetch: async input => {
    if (String(input).startsWith('/fixtures/')) return new Response(payload);
    if (String(input).endsWith('/complete')) { completionRequests++; throw new Error('Unexpected completion'); }
    if (String(input).endsWith('/parts')) return Response.json({ parts: Array.from({ length: 8 }, (_, index) => ({ partNumber: index + 1, upload: { method: 'PUT', url: `http://minio:9000/uploads/part-${index + 1}`, headers: {} } })) });
    return Response.json({ sessionId: 'session', assetId: '01ARZ3NDEKTSV4RRFFQ69G5FAW', strategy: 'MULTIPART', partSize: 1, partCount: 8 });
  } };
  vm.runInNewContext((await browserBundle(true)).outputFiles[0].text, { window, XMLHttpRequest: Request, performance, AbortSignal, AbortController, DOMException, Blob, File, Response, URL, crypto: webcrypto, setTimeout, clearTimeout, localStorage: { getItem: () => 'owner' } });
  await window.benchmark.prepare([{ name: 'fixture.bin', bytes: 8, sha256, type: 'application/octet-stream' }]);
  const result = await window.benchmark.run({ id: 'real-multipart', fixture: 'fixture.bin', timeoutMs: 30 });
  const startsAtReturn = startedRequests.length;
  assert.equal(result.outcome, 'timeout');
  assert.ok(startsAtReturn > 0);
  assert.ok(startedRequests.every(request => request.aborted));
  assert.equal(result.putAttempts, startsAtReturn);
  assert.equal(result.activePutsAtReturn, 0);
  assert.equal(window.benchmark.putMetrics().activePuts, 0);
  assert.equal(window.clientSignal.aborted, true);
  assert.equal(result.clientTaskSettled, window.observedClientSettled);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(startedRequests.length, startsAtReturn);
  assert.equal(completionRequests, 0);
  context.diagnostic(`Observed real multipart PUTs started and aborted: ${startsAtReturn}; client settled: ${window.observedClientSettled}`);
});

test('a multipart deadline aborts every active PUT and rejects a subsequent send', async () => {
  const payload = new Uint8Array([1, 2, 3, 4]);
  const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', payload)).toString('hex');
  let nativeSends = 0;
  let abortedPuts = 0;
  let subsequentSendError;
  class Request {
    events = new Map();
    upload = { addEventListener() {} };
    open() {}
    addEventListener(name, callback) { this.events.set(name, [...(this.events.get(name) ?? []), callback]); }
    send() { nativeSends++; }
    abort() {
      abortedPuts++;
      this.onabort?.();
      for (const name of ['abort', 'loadend']) for (const callback of this.events.get(name) ?? []) callback();
    }
  }
  const parts = [1, 2, 3, 4].map(partNumber => ({ partNumber, upload: { url: `http://minio:9000/uploads/part-${partNumber}` } }));
  const window = { fetch: async input => {
    if (String(input).startsWith('/fixtures/')) return new Response(payload);
    if (String(input).endsWith('/parts')) return Response.json({ parts });
    return Response.json({ sessionId: 'session', assetId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' });
  } };
  vm.runInNewContext(bundle.outputFiles[0].text, { window, XMLHttpRequest: Request, performance, AbortSignal, AbortController, DOMException, Blob, File, Response, URL, crypto: webcrypto, setTimeout, clearTimeout });
  window.testUpload = async ({ file }) => {
    await window.fetch('http://api:8080/api/v1/upload-sessions', { body: JSON.stringify({ filename: file.name }) });
    await window.fetch('http://api:8080/api/v1/upload-sessions/session/parts');
    const subsequent = new Request();
    subsequent.open('PUT', parts[3].upload.url);
    await Promise.all(parts.slice(0, 3).map((part, index) => new Promise((_, reject) => {
      const request = new Request();
      request.open('PUT', part.upload.url);
      request.onabort = () => {
        if (index === 0) {
          try { subsequent.send(file); } catch (error) { subsequentSendError = error; }
        }
        reject(new DOMException('Aborted', 'AbortError'));
      };
      request.send(file);
    })));
  };
  await window.benchmark.prepare([{ name: 'fixture.bin', bytes: 4, sha256, type: 'application/octet-stream' }]);
  const result = await window.benchmark.run({ id: 'multipart', fixture: 'fixture.bin', timeoutMs: 30 });
  assert.equal(result.outcome, 'timeout');
  assert.equal(nativeSends, 3);
  assert.equal(abortedPuts, 3);
  assert.equal(subsequentSendError?.name, 'AbortError');
  assert.equal(result.putAttempts, 3);
  assert.equal(result.clientTaskSettled, true);
  assert.equal(result.activePutsAtReturn, 0);
  assert.equal(window.benchmark.putMetrics().activePuts, 0);
});


test('scheduled trace selection survives session creation for an unsampled asset ID', async () => {
  const { result } = await runAbort(false, false, false, { sampled: true });
  assert.equal(result.sampled, true);
  assert.equal(result.serverTraceSampled, false);
  assert.ok(result.spans.some(span => span.stage.endsWith('/upload-sessions')));
});

test('asset-ID sampling retains client spans that can join API and worker traces', async () => {
  const { result } = await runAbort(false, false, false, { assetId: '01ARZ3NDEKTSV4RRFFQ69G5F00' });
  assert.equal(result.sampled, true);
  assert.equal(result.serverTraceSampled, true);
  assert.ok(result.spans.some(span => span.stage.endsWith('/upload-sessions')));
});

test('an operation selected by neither trace rule records no spans', async () => {
  const { result } = await runAbort(false);
  assert.equal(result.sampled, false);
  assert.equal(result.serverTraceSampled, false);
  assert.equal(result.spans.length, 0);
});
