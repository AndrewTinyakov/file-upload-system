import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDocumentStorage, resolveStorageSettings, storageHash } from '../src/storage-settings.mjs';

const environment = [
  'MINIO_COMPRESSION_ENABLE=on',
  'MINIO_COMPRESSION_ALLOW_ENCRYPTION=off',
  'MINIO_COMPRESSION_EXTENSIONS=.txt,.log,.csv,.json,.tar,.xml,.bin',
  'MINIO_COMPRESSION_MIME_TYPES=application/octet-stream',
];
const config = {
  status: 'success',
  config: [{ subSystem: 'compression', kv: [
    { key: 'enable', value: 'off', envOverride: { name: 'MINIO_COMPRESSION_ENABLE', value: 'on' } },
    { key: 'allow_encryption', value: 'off', envOverride: { name: 'MINIO_COMPRESSION_ALLOW_ENCRYPTION', value: 'off' } },
    { key: 'extensions', value: '.txt,.log,.csv,.json,.tar,.xml,.bin', envOverride: { name: 'MINIO_COMPRESSION_EXTENSIONS', value: '.txt,.log,.csv,.json,.tar,.xml,.bin' } },
    { key: 'mime_types', value: 'text/*,application/json,application/xml,binary/octet-stream', envOverride: { name: 'MINIO_COMPRESSION_MIME_TYPES', value: 'application/octet-stream' } },
  ] }],
};

test('reported modern environment overrides take precedence over persisted MinIO defaults', () => {
  assert.deepEqual(resolveStorageSettings(config, environment, 'on'), {
    enable: 'on', allow_encryption: 'off', extensions: '.txt,.log,.csv,.json,.tar,.xml,.bin', mime_types: 'application/octet-stream',
  });
  assert.throws(() => resolveStorageSettings(config, environment, 'off'), /environment/);
});

test('legacy, missing and inconsistent settings cannot masquerade as the declared storage trial', () => {
  assert.throws(() => resolveStorageSettings(config, [...environment, 'MINIO_COMPRESS=off'], 'on'), /legacy/);
  assert.throws(() => resolveStorageSettings(config, environment.slice(1), 'on'), /missing/);
  for (const change of [
    value => { value.config[0].kv[0].envOverride.value = 'off'; },
    value => { value.config[0].kv[3].envOverride.name = 'MINIO_COMPRESS_MIMETYPES'; },
    value => { value.config[0].kv.push({ key: 'future_setting', value: 'unrecorded' }); },
    value => { value.config[0].kv.push(value.config[0].kv[0]); },
    value => { value.status = 'error'; },
  ]) {
    const changed = structuredClone(config);
    change(changed);
    assert.throws(() => resolveStorageSettings(changed, environment, 'on'));
  }
});

test('document settings hash ignores policy set ordering and preserves effective differences', () => {
  const first = { versioning: 'Enabled', policy: { Statement: [{ Effect: 'Allow', Action: ['s3:GetObjectVersion', 's3:GetObject'], Resource: ['documents/*'], Principal: { AWS: ['*'] } }] }, lifecycle: { Rules: [{ ID: 'pending', Expiration: { Days: 7 } }] } };
  const reordered = { lifecycle: first.lifecycle, policy: { Statement: [{ Principal: { AWS: ['*'] }, Resource: ['documents/*'], Action: ['s3:GetObject', 's3:GetObjectVersion'], Effect: 'Allow' }] }, versioning: 'Enabled' };
  const fingerprint = value => storageHash(canonicalDocumentStorage(value));
  assert.equal(fingerprint(first), fingerprint(reordered));
  assert.notEqual(fingerprint(first), fingerprint({ ...reordered, versioning: 'Suspended' }));
  assert.notEqual(fingerprint(first), fingerprint({ ...reordered, lifecycle: { Rules: [{ ID: 'pending', Expiration: { Days: 6 } }] } }));
  assert.notEqual(fingerprint(first), fingerprint({ ...reordered, policy: { Statement: [] } }));
});

test('runtime provenance rejects undeclared or misreported storage parallelism', async () => {
  const { resolveRuntimeSettings } = await import('../src/storage-settings.mjs');
  const info = { status: 'success', info: { servers: [{ go_max_procs: 11, num_cpu: 11, runtime_version: 'go1.24.6' }] } };
  assert.deepEqual(resolveRuntimeSettings(info, ['GOMAXPROCS='], 'host'), { mode: 'host', gomaxprocs: 11, numCpu: 11, goVersion: 'go1.24.6', environment: ['GOMAXPROCS='] });
  const tuned = structuredClone(info);
  tuned.info.servers[0].go_max_procs = 2;
  assert.equal(resolveRuntimeSettings(tuned, ['GOMAXPROCS=2'], '2').gomaxprocs, 2);
  for (const [value, environment, mode] of [[info, ['GOMAXPROCS=2'], '2'], [tuned, ['GOMAXPROCS=3'], '2'], [info, ['GOMAXPROCS='], '3'], [info, ['GODEBUG=containermaxprocs=1', 'GOMAXPROCS='], 'host'], [{ status: 'error' }, ['GOMAXPROCS='], 'host']]) {
    assert.throws(() => resolveRuntimeSettings(value, environment, mode));
  }
});
