import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docker, dockerExec, sample } from './docker.mjs';
import { sha256, storageRequest } from './storage-http.mjs';

const MiB = 1024 * 1024;
const counters = ['cpuSeconds', 'networkRxBytes', 'networkTxBytes', 'storageReadBytes', 'storageWriteBytes', 'throttledSeconds'];
const delta = (before, after) => Object.fromEntries(counters.map(name => [name, after[name] - before[name]]));
const xml = (body, name) => {
  const value = body.toString().match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1];
  assert.ok(value, `Missing ${name} in S3 response: ${body.toString().slice(0, 1000)}`);
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
};
const escapeXml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function repeated(bytes) {
  const result = Buffer.alloc(bytes);
  const text = Buffer.from('Seeded benchmark document. Original bytes must survive retrieval.\n');
  for (let offset = 0; offset < bytes; offset += text.length) text.copy(result, offset);
  return result;
}

function noise(bytes) {
  const result = Buffer.allocUnsafe(bytes);
  let state = 0x7a5c31e9;
  for (let offset = 0; offset < bytes; offset += 4) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    result.writeUInt32LE(state >>> 0, offset);
  }
  return result;
}

async function representation(containerId, bucket, key) {
  const path = `/data/${bucket}/${key}`;
  const archive = await docker(`/containers/${containerId}/archive?path=${encodeURIComponent(path)}`, 'GET', undefined, true);
  const files = [];
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/, '');
    const size = Number.parseInt(field(124, 136).trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0, 'Invalid Docker archive file size');
    assert.ok(offset + 512 + size <= archive.length, 'Truncated Docker storage archive');
    const name = [field(345, 500), field(0, 100)].filter(Boolean).join('/');
    if (header[156] === 0 || header[156] === 48) files.push({ path: name, bytes: size });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(files.length, `No storage representation found for ${bucket}/${key}`);
  assert.ok(files.some(file => file.path.endsWith('/xl.meta')), `Missing xl.meta for ${bucket}/${key}`);
  return { bytes: files.reduce((sum, file) => sum + file.bytes, 0), files, measure: 'sum of regular-file lengths including xl.meta; excludes directory and filesystem allocation overhead' };
}

export async function compressionProbe({ containerId, directory, mode }) {
  assert.ok(containerId && directory, 'Compression probe needs containerId and directory');
  assert.ok(mode === 'on' || mode === 'off', 'Compression probe mode must be on or off');
  await mkdir(directory, { recursive: true });
  const artifact = join(directory, 'compression-preflight.json');
  const started = performance.now();
  const prefix = `compression-preflight/${randomUUID()}`;
  const objects = [];
  const uploads = [];
  const result = {
    schemaVersion: 1, mode, verified: false, status: 'running', startedAt: new Date().toISOString(), prefix,
    endpoint: 'http://minio:9000', transport: 'node:http, raw response bytes without content decoding',
    compressionThreshold: 0.25, noiseSeed: '0x7a5c31e9', cases: [], cleanup: [],
  };
  const container = { id: containerId, service: 'minio' };
  let failure;
  let baseline;
  async function request(record, label, specification, expected = 200) {
    const response = await storageRequest(specification);
    record.operations.push({ label, method: specification.method ?? 'GET', bucket: specification.bucket, key: specification.key,
      query: specification.query, requestHeaders: specification.headers ?? {}, requestBytes: Buffer.byteLength(specification.body ?? ''),
      status: response.status, headers: response.headers, bytes: response.body.length, sha256: sha256(response.body), durationMs: response.durationMs });
    assert.equal(response.status, expected, `${label} returned ${response.status}: ${response.body.toString().slice(0, 1000)}`);
    return response;
  }
  async function verify(record, bucket, key, payload, contentType, multipart) {
    const head = await request(record, `${bucket}: HEAD`, { method: 'HEAD', bucket, key });
    assert.equal(Number(head.headers['content-length']), payload.length, `${bucket}: HEAD logical length`);
    assert.equal(head.headers['content-type'], contentType, `${bucket}: HEAD content type`);
    assert.equal(head.headers['content-encoding'], undefined, `${bucket}: HEAD Content-Encoding must be absent`);
    assert.ok(head.headers.etag, `${bucket}: HEAD ETag missing`);
    const full = await request(record, `${bucket}: full GET with matching If-Match`, { bucket, key, headers: { 'if-match': head.headers.etag } });
    assert.equal(full.body.length, payload.length, `${bucket}: raw GET logical length`);
    assert.equal(Number(full.headers['content-length']), payload.length, `${bucket}: GET Content-Length`);
    assert.equal(full.headers['content-type'], contentType, `${bucket}: GET content type`);
    assert.equal(full.headers['content-encoding'], undefined, `${bucket}: GET Content-Encoding must be absent`);
    assert.equal(sha256(full.body), sha256(payload), `${bucket}: raw GET SHA256`);
    await request(record, `${bucket}: GET with mismatched If-Match`, { bucket, key, headers: { 'if-match': '"compression-preflight-mismatch"' } }, 412);
    await request(record, `${bucket}: HEAD with matching If-Match`, { method: 'HEAD', bucket, key, headers: { 'if-match': head.headers.etag } });
    await request(record, `${bucket}: HEAD with mismatched If-Match`, { method: 'HEAD', bucket, key, headers: { 'if-match': '"compression-preflight-mismatch"' } }, 412);
    const ranges = [
      { name: 'prefix', header: 'bytes=0-255', start: 0, end: 255 },
      { name: 'middle', start: Math.floor(payload.length / 2) - 128, end: Math.floor(payload.length / 2) + 127 },
      { name: 'suffix', header: 'bytes=-256', start: payload.length - 256, end: payload.length - 1 },
    ];
    if (multipart) ranges.push({ name: 'multipart boundary', start: 5 * MiB - 128, end: 5 * MiB + 127 });
    for (const range of ranges) {
      const response = await request(record, `${bucket}: ${range.name} range`, { bucket, key, headers: { range: range.header ?? `bytes=${range.start}-${range.end}`, 'if-match': head.headers.etag } }, 206);
      assert.equal(response.headers['content-range'], `bytes ${range.start}-${range.end}/${payload.length}`, `${bucket}: ${range.name} Content-Range`);
      assert.equal(Number(response.headers['content-length']), range.end - range.start + 1, `${bucket}: ${range.name} Content-Length`);
      assert.equal(response.headers['content-encoding'], undefined, `${bucket}: ${range.name} Content-Encoding must be absent`);
      assert.deepEqual(response.body, payload.subarray(range.start, range.end + 1), `${bucket}: ${range.name} raw bytes`);
    }
    const physical = await representation(containerId, bucket, key);
    physical.ratioToLogicalBytes = physical.bytes / payload.length;
    const verified = { bucket, key, logicalBytes: payload.length, sha256: sha256(payload), contentType, etag: head.headers.etag, physical };
    record.objects.push(verified);
    if (mode === 'on' && record.compressible) assert.ok(physical.bytes < payload.length * result.compressionThreshold, `${bucket}/${key} did not shrink below ${result.compressionThreshold} of logical bytes: ${physical.bytes}/${payload.length}`);
    else assert.ok(physical.bytes >= payload.length, `${bucket}/${key} unexpectedly shrank: ${physical.bytes}/${payload.length}`);
    return verified;
  }
  try {
    baseline = await sample(container);
    result.resourcesBefore = baseline;
    const inspect = await docker(`/containers/${containerId}/json`);
    result.versions = { node: process.version, image: inspect.Config?.Image, imageId: inspect.Image, minio: (await dockerExec(containerId, ['minio', '--version'])).trim() };
    const text = repeated(MiB);
    const fixtures = [
      { name: 'text', payload: text, contentType: 'application/octet-stream', compressible: true },
      { name: 'image-mime-exclusion', payload: text, contentType: 'image/png', compressible: false },
      { name: 'multipart-text', payload: repeated(6 * MiB), contentType: 'application/octet-stream', compressible: true, multipart: true },
      { name: 'seeded-noise', payload: noise(MiB), contentType: 'application/octet-stream', compressible: false },
    ];
    for (const fixture of fixtures) {
      const record = { name: fixture.name, contentType: fixture.contentType, logicalBytes: fixture.payload.length,
        sha256: sha256(fixture.payload), compressible: fixture.compressible, multipart: Boolean(fixture.multipart), operations: [], objects: [], status: 'running' };
      result.cases.push(record);
      const caseStarted = performance.now();
      const before = await sample(container);
      const key = `${prefix}/${fixture.name}`;
      objects.push({ bucket: 'uploads', key }, { bucket: 'assets', key });
      try {
        if (fixture.multipart) {
          const created = await request(record, 'initiate multipart upload', { method: 'POST', bucket: 'uploads', key, query: { uploads: '' }, headers: { 'content-type': fixture.contentType } });
          const uploadId = xml(created.body, 'UploadId');
          const upload = { bucket: 'uploads', key, uploadId };
          uploads.push(upload);
          const parts = [];
          for (const [index, part] of [fixture.payload.subarray(0, 5 * MiB), fixture.payload.subarray(5 * MiB)].entries()) {
            const uploaded = await request(record, `upload part ${index + 1}`, { method: 'PUT', bucket: 'uploads', key, query: { uploadId, partNumber: index + 1 }, body: part });
            assert.ok(uploaded.headers.etag, `Upload part ${index + 1} missing ETag`);
            parts.push({ partNumber: index + 1, bytes: part.length, etag: uploaded.headers.etag });
          }
          record.parts = parts;
          const body = `<CompleteMultipartUpload>${parts.map(part => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
          const completed = await request(record, 'complete multipart upload', { method: 'POST', bucket: 'uploads', key, query: { uploadId }, headers: { 'content-type': 'application/xml' }, body });
          assert.ok(!completed.body.toString().includes('<Error>'), `Multipart completion returned an embedded error: ${completed.body.toString()}`);
          xml(completed.body, 'ETag');
          uploads.splice(uploads.indexOf(upload), 1);
        } else {
          await request(record, 'PUT upload', { method: 'PUT', bucket: 'uploads', key, headers: { 'content-type': fixture.contentType }, body: fixture.payload });
        }
        const source = await verify(record, 'uploads', key, fixture.payload, fixture.contentType, fixture.multipart);
        const copyHeaders = { 'x-amz-copy-source': `/uploads/${key}`, 'x-amz-copy-source-if-match': source.etag, 'x-amz-metadata-directive': 'REPLACE', 'content-type': fixture.contentType };
        await request(record, 'CopyObject with mismatched source ETag', { method: 'PUT', bucket: 'assets', key, headers: { ...copyHeaders, 'x-amz-copy-source-if-match': '"compression-preflight-mismatch"' } }, 412);
        const copied = await request(record, 'conditional CopyObject with REPLACE', { method: 'PUT', bucket: 'assets', key, headers: copyHeaders });
        assert.ok(!copied.body.toString().includes('<Error>'), `CopyObject returned an embedded error: ${copied.body.toString()}`);
        xml(copied.body, 'ETag');
        await verify(record, 'assets', key, fixture.payload, fixture.contentType, fixture.multipart);
        record.status = 'passed';
      } catch (error) {
        record.status = 'failed';
        record.error = error.stack ?? String(error);
        throw error;
      } finally {
        const after = await sample(container);
        record.resourcesBefore = before;
        record.resourcesAfter = after;
        record.resourceDelta = delta(before, after);
        record.durationMs = performance.now() - caseStarted;
      }
    }
    result.status = 'passed';
  } catch (error) {
    failure = error;
    result.status = 'failed';
    result.error = error.stack ?? String(error);
  } finally {
    for (const upload of uploads) {
      try {
        const response = await storageRequest({ method: 'DELETE', bucket: upload.bucket, key: upload.key, query: { uploadId: upload.uploadId } });
        assert.ok([204, 404].includes(response.status), `Abort multipart upload returned ${response.status}`);
        result.cleanup.push({ action: 'abort multipart upload', ...upload, status: response.status, ok: true });
      } catch (error) {
        result.cleanup.push({ action: 'abort multipart upload', ...upload, ok: false, error: String(error) });
        failure ??= error;
      }
    }
    for (const object of objects) {
      try {
        const response = await storageRequest({ method: 'DELETE', ...object });
        assert.equal(response.status, 204, `Object cleanup returned ${response.status}`);
        result.cleanup.push({ action: 'delete object', ...object, status: response.status, ok: true });
      } catch (error) {
        result.cleanup.push({ action: 'delete object', ...object, ok: false, error: String(error) });
        failure ??= error;
      }
    }
    try {
      result.resourcesAfter = await sample(container);
      if (baseline) result.resourceDelta = delta(baseline, result.resourcesAfter);
    } catch (error) {
      result.resourceError = String(error);
      failure ??= error;
    }
    result.finishedAt = new Date().toISOString();
    result.durationMs = performance.now() - started;
    result.status = failure ? 'failed' : 'passed';
    result.verified = !failure;
    if (failure) result.error ??= failure.stack ?? String(failure);
    result.totals = result.cases.flatMap(record => record.objects).reduce((total, object) => ({
      objects: total.objects + 1, logicalBytes: total.logicalBytes + object.logicalBytes, representationBytes: total.representationBytes + object.physical.bytes,
    }), { objects: 0, logicalBytes: 0, representationBytes: 0 });
    result.artifact = artifact;
    await writeFile(artifact, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (failure) throw new Error(`MinIO compression preflight failed; see ${artifact}: ${failure.message}`, { cause: failure });
  return result;
}
