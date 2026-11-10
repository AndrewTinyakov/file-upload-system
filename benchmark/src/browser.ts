import { uploadFile, getUserId } from '/src/client/src/upload';
import { OpenAPI, UploadSessionControllerService } from '/src/client/src/api/generated';

OpenAPI.BASE = 'http://api:8080/api';
const nativeFetch = window.fetch.bind(window);
const files = new Map<string, { blob: Blob; spec: any }>();
const operations = new Map<string, any>();
const routes = new Map<string, any>();
let activePuts = 0;
let peakActivePuts = 0;
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

window.fetch = async (input, options) => {
  const url = String(input);
  let operation = routes.get(new URL(url).pathname);
  if (url.endsWith('/upload-sessions') && options?.body) {
    const body = JSON.parse(String(options.body));
    operation = operations.get(body.filename.split('--')[0]);
  }
  const started = now();
  const requestOptions = operation ? { ...options, signal: AbortSignal.any([operation.controller.signal, options?.signal].filter(Boolean)) } : options;
  const countAttempt = () => {
    if (!operation) return;
    operation.requests++;
    operation.apiRequests++;
    if (/\/assets\//.test(new URL(url).pathname)) operation.pollRequests++;
  };
  countAttempt();
  let response = await nativeFetch(input, requestOptions);
  if (operation) {
    const body = await response.clone().json().catch(() => null);
    if (body?.sessionId) {
      operation.sessionId = body.sessionId;
      operation.assetId = body.assetId;
      const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      const suffix = body.assetId.slice(-2).split('').reduce((total: number, char: string) => total * 32 + alphabet.indexOf(char), 0);
      operation.sampled = suffix % 100 === 0;
      if (body.upload) operation.sourceUrl = body.upload.url.split('?')[0];
      routes.set(`/api/v1/assets/${body.assetId}`, operation);
      for (const suffix of ['', '/complete', '/parts', '/abort']) routes.set(`/api/v1/upload-sessions/${body.sessionId}${suffix}`, operation);
      if (body.upload) routes.set(body.upload.url, operation);
    }
    for (const part of body?.parts ?? []) if (part.upload) {
      routes.set(part.upload.url, operation);
      operation.sourceUrl = part.upload.url.split('?')[0];
    }
    if (operation.retry && url.endsWith('/complete') && response.ok) {
      operation.retry = false;
      operation.retries++;
      operation.injected = 'lost-complete-response';
      countAttempt();
      response = await nativeFetch(input, requestOptions);
    }
    if (operation.sampled) operation.spans.push({ stage: url.split('?')[0], started, finished: now(), status: response.status });
  }
  return response;
};

const nativeOpen = XMLHttpRequest.prototype.open;
const nativeSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
  (this as any).benchmarkOperation = routes.get(String(url));
  return (nativeOpen as any).call(this, method, url, ...args);
};
XMLHttpRequest.prototype.send = function(body) {
  const operation = (this as any).benchmarkOperation;
  if (!operation) return nativeSend.call(this, body);
  operation.requests++;
  operation.putAttempts++;
  operation.activeRequest = this;
  activePuts++;
  peakActivePuts = Math.max(peakActivePuts, activePuts);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activePuts--;
  };
  this.addEventListener('readystatechange', () => {
    if (this.readyState === 4) release();
  });
  const send = () => {
    try { return nativeSend.call(this, body); }
    catch (error) { release(); throw error; }
  };
  const started = now();
  let lastLoaded = 0;
  this.upload.addEventListener('progress', event => {
    operation.attemptedUploadBytes += Math.max(0, event.loaded - lastLoaded);
    lastLoaded = event.loaded;
  });
  this.addEventListener('loadend', () => {
    release();
    if (operation.sampled) operation.spans.push({ stage: 'storage-put', started, finished: now(), status: this.status });
  });
  this.addEventListener('abort', () => { operation.abortObserved = true; });
  if (operation.interrupt || operation.cancel) {
    this.upload.addEventListener('progress', event => {
      if (!operation.injected && event.loaded > 0 && event.loaded < event.total) {
        operation.injected = operation.cancel ? 'cancel' : 'interrupt';
        operation.interruptedBytes = event.loaded;
        this.abort();
      }
    });
    send();
    return;
  }
  return send();
};

async function digest(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function cleanupUrl(value: string) {
  const url = new URL(value);
  const versionId = url.searchParams.get('versionId');
  url.search = '';
  if (versionId) url.searchParams.set('versionId', versionId);
  return url.href;
}

async function prepare(manifest: any[]) {
  for (const spec of manifest) {
    const blob = await (await nativeFetch(`/fixtures/${spec.name}`)).blob();
    if (blob.size !== spec.bytes || await digest(await blob.arrayBuffer()) !== spec.sha256) throw new Error(`Fixture mismatch ${spec.name}`);
    files.set(spec.name, { blob, spec });
  }
  return { userId: getUserId(), fixtureCount: files.size };
}

async function run(input: any) {
  const cached = files.get(input.fixture);
  if (!cached) throw new Error(`Missing fixture ${input.fixture}`);
  const operation: any = { ...input, requests: 0, apiRequests: 0, pollRequests: 0, putAttempts: 0, attemptedUploadBytes: 0, retries: 0, spans: [], stageMs: {}, startMs: now(), controller: new AbortController() };
  operations.set(input.id, operation);
  let asset: any;
  let stageAt = operation.startMs;
  let stage = 'creating';
  let timer: ReturnType<typeof setTimeout>;
  let runningTask: Promise<void> | undefined;
  let abortTask: Promise<unknown> | undefined;
  let deadlineTask: Promise<never> | undefined;
  try {
    const task = runningTask = (async () => {
      await uploadFile({
      signal: operation.controller.signal,
      file: new File([cached.blob], `${input.id}--${input.fixture}`, { type: cached.spec.type }),
      onAsset: value => { asset = value; },
      onEvent: () => {},
      onProgress: () => {},
      onPhase: value => {
        operation.stageMs[stage] = now() - stageAt;
        stageAt = now();
        stage = value;
        if (value === 'ready') operation.readyMs = now();
      },
      });
      if (input.slowControlMs) {
        await sleep(input.slowControlMs);
        operation.readyMs += input.slowControlMs;
      }
      if (asset?.status !== 'READY') throw new Error(`Asset status ${asset?.status}`);
      const expectedTypes = cached.spec.format ? ['DISPLAY_LARGE', 'DISPLAY_MEDIUM', 'DISPLAY_SMALL', 'DOWNLOAD'] : ['ORIGINAL'];
      if (JSON.stringify(asset.variants.map((variant: any) => variant.variantType).sort()) !== JSON.stringify(expectedTypes)) throw new Error('Unexpected variant set');
      operation.cleanupUrls = asset.variants.map((variant: any) => cleanupUrl(variant.url));
      if (operation.sourceUrl) operation.cleanupUrls.push(operation.sourceUrl);
      operation.cleanupUrls.push(operation.cleanupUrls[0].replace(/\/[^/]+$/, '/complete.json'));
      operation.referenceVariants = [];
      for (const variant of asset.variants) {
        const response = await nativeFetch(variant.url, { signal: operation.controller.signal });
        if (!response.ok) throw new Error(`Download returned ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== variant.byteSize) throw new Error('Variant length mismatch');
        const sha256 = await digest(bytes);
        if (!cached.spec.format) {
          if (sha256 !== cached.spec.sha256) throw new Error('Document integrity mismatch');
        } else {
          const bitmap = await createImageBitmap(new Blob([bytes], { type: variant.contentType }));
          const maximumWidth = ({ DISPLAY_SMALL: 480, DISPLAY_MEDIUM: 1280, DISPLAY_LARGE: 1920 } as Record<string, number>)[variant.variantType] ?? cached.spec.width;
          if (bitmap.width !== Math.min(maximumWidth, cached.spec.width) || bitmap.width !== variant.width || bitmap.height !== variant.height) throw new Error('Image dimensions mismatch');
          bitmap.close();
          const observed = { variantType: variant.variantType, width: variant.width, height: variant.height, contentType: variant.contentType, byteSize: bytes.byteLength, sha256 };
          operation.referenceVariants.push(observed);
          if (!input.captureReference) {
            const expected = input.reference?.find((entry: any) => entry.variantType === variant.variantType);
            if (!expected || JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error(`Image output changed for ${variant.variantType}`);
          }
        }
      }
    })();
    abortTask = (async () => {
      if (!operation.interrupt && !operation.cancel) return new Promise(() => {});
      const deadline = now() + input.timeoutMs;
      while (!operation.abortObserved && !operation.done && now() < deadline) await sleep(10);
      if (!operation.abortObserved) throw new Error('Fault injection did not reach storage');
      const aborted = await UploadSessionControllerService.abort(getUserId(), operation.sessionId);
      if (aborted.status !== 'ABORTED') throw new Error(`Abort returned ${aborted.status}`);
      operation.serverAbortObserved = true;
      throw new Error('EXPECTED_ABORT');
    })();
    deadlineTask = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('OPERATION_TIMEOUT')), input.timeoutMs); });
    await Promise.race([task, abortTask, deadlineTask]);
    operation.outcome = 'success';
  } catch (error) {
    if (operation.abortObserved && (operation.interrupt || operation.cancel) && !(error instanceof Error && error.message === 'OPERATION_TIMEOUT')) {
      try { await Promise.race([abortTask, deadlineTask!]); } catch (abortError) { error = abortError; }
    }
    operation.error = error instanceof Error ? error.message : String(error);
    operation.outcome = operation.error === 'EXPECTED_ABORT' && operation.abortObserved ? 'expected_fault' : operation.error === 'OPERATION_TIMEOUT' ? 'timeout' : 'error';
  } finally {
    clearTimeout(timer!);
    operation.done = true;
    operation.controller.abort();
    operation.activeRequest?.abort();
    await Promise.race([runningTask?.catch(() => {}), sleep(1000)]);
    operation.endMs = now();
    operation.stageMs[stage] = operation.endMs - stageAt;
    operations.delete(input.id);
    for (const [key, value] of routes) if (value === operation) routes.delete(key);
    delete operation.activeRequest;
    delete operation.controller;
    delete operation.retry;
    delete operation.sourceUrl;
    return operation;
  }
}

(window as any).benchmark = {
  prepare,
  run,
  putMetrics: (reset = false) => {
    if (reset) peakActivePuts = activePuts;
    return { activePuts, peakActivePuts };
  },
};
