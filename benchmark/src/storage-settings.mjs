import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { docker, dockerExec } from './docker.mjs';

export const storageTrial = {
  version: 2,
  candidateSetting: 'MINIO_COMPRESSION_ENABLE',
  runtimeTrial: { candidateSetting: 'GOMAXPROCS', modes: ['host', '2'], baseline: 'host' },
  fixed: {
    allow_encryption: 'off',
    extensions: '.txt,.log,.csv,.json,.tar,.xml,.bin',
    mime_types: 'application/octet-stream',
  },
};
const variables = {
  enable: 'MINIO_COMPRESSION_ENABLE',
  allow_encryption: 'MINIO_COMPRESSION_ALLOW_ENCRYPTION',
  extensions: 'MINIO_COMPRESSION_EXTENSIONS',
  mime_types: 'MINIO_COMPRESSION_MIME_TYPES',
};
export const storageHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function resolveRuntimeSettings(info, environment, mode) {
  if (!['host', '2'].includes(mode)) throw new Error('Undeclared storage runtime trial');
  const runtimeEnvironment = environment.filter(entry => /^(GOMAXPROCS|GODEBUG|GOMEMLIMIT|GOGC)=/.test(entry)).sort();
  const expected = [`GOMAXPROCS=${mode === 'host' ? '' : mode}`];
  if (JSON.stringify(runtimeEnvironment) !== JSON.stringify(expected)) throw new Error('Unexpected storage runtime environment');
  const servers = info.info?.servers;
  if (info.status !== 'success' || servers?.length !== 1) throw new Error('Missing storage runtime report');
  const server = servers[0];
  if (!Number.isInteger(server.num_cpu) || server.num_cpu < 1 || !server.runtime_version) throw new Error('Incomplete storage runtime report');
  if (server.go_max_procs !== (mode === 'host' ? server.num_cpu : 2)) throw new Error('Storage runtime parallelism differs from trial');
  return { mode, gomaxprocs: server.go_max_procs, numCpu: server.num_cpu, goVersion: server.runtime_version, environment: runtimeEnvironment };
}

export function canonicalDocumentStorage(value) {
  if (Array.isArray(value)) return value.map(canonicalDocumentStorage).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalDocumentStorage(value[key])]));
  return value;
}

export function resolveStorageSettings(config, environment, mode) {
  if (!['off', 'on'].includes(mode)) throw new Error('Storage compression trial must be off or on');
  if (config.status !== 'success') throw new Error('Storage configuration capture failed');
  const systems = config.config?.filter(entry => entry.subSystem === 'compression');
  if (systems?.length !== 1) throw new Error('Expected one storage compression configuration');
  const entries = systems[0].kv;
  if (!Array.isArray(entries) || new Set(entries.map(entry => entry.key)).size !== entries.length) throw new Error('Invalid storage compression keys');
  const compressionEnvironment = environment.filter(entry => /^MINIO_COMPRESS/.test(entry));
  const expected = { enable: mode, ...storageTrial.fixed };
  const expectedEnvironment = Object.entries(variables).map(([key, name]) => `${name}=${expected[key]}`).sort();
  if (JSON.stringify([...compressionEnvironment].sort()) !== JSON.stringify(expectedEnvironment)) throw new Error('Unexpected, missing or legacy storage compression environment');
  const effective = {};
  for (const [key, name] of Object.entries(variables)) {
    const entry = entries.find(entry => entry.key === key);
    const override = entry?.envOverride;
    if (override && (override.name !== name || override.value !== expected[key])) throw new Error(`Unexpected storage override ${key}`);
    effective[key] = override?.value ?? entry?.value ?? (key === 'enable' ? 'on' : undefined);
    if (effective[key] !== expected[key]) throw new Error(`Storage setting ${key} does not match ${expected[key]}`);
    if (!override && entry?.value !== expected[key]) throw new Error(`Storage environment was not reported for ${key}`);
  }
  for (const entry of entries) if (!(entry.key in variables) && entry.key !== 'comment') throw new Error(`Unrecorded compression setting ${entry.key}`);
  return effective;
}

export async function captureStorageSettings(containerId, directory, phase, mode, runtimeMode) {
  const inspect = await docker(`/containers/${containerId}/json`);
  await dockerExec(containerId, ['mc', 'alias', 'set', 'benchmark', 'http://localhost:9000', 'file_upload', 'file_upload']);
  const json = await dockerExec(containerId, ['mc', '--json', 'admin', 'config', 'get', 'benchmark', 'compression']);
  const text = await dockerExec(containerId, ['mc', '--no-color', 'admin', 'config', 'get', 'benchmark', 'compression']);
  const environment = inspect.Config.Env.filter(entry => /^MINIO_COMPRESS/.test(entry)).sort();
  const effective = resolveStorageSettings(JSON.parse(json), environment, mode);
  const runtimeInfo = JSON.parse(await dockerExec(containerId, ['mc', '--json', 'admin', 'info', 'benchmark']));
  const runtimeEnvironment = inspect.Config.Env.filter(entry => /^(GOMAXPROCS|GODEBUG|GOMEMLIMIT|GOGC)=/.test(entry)).sort();
  const runtime = resolveRuntimeSettings(runtimeInfo, runtimeEnvironment, runtimeMode);
  const documentVersioning = JSON.parse(await dockerExec(containerId, ['mc', '--json', 'version', 'info', 'benchmark/documents']));
  if (documentVersioning.status !== 'success' || documentVersioning.versioning?.status !== 'Enabled') throw new Error('Document storage versioning is not enabled');
  const documentStorage = {
    versioning: documentVersioning.versioning.status,
    lifecycle: JSON.parse(await dockerExec(containerId, ['mc', 'ilm', 'export', 'benchmark/documents'])),
    policy: JSON.parse(await dockerExec(containerId, ['mc', 'anonymous', 'get-json', 'benchmark/documents'])),
  };
  const apiConfig = JSON.parse(await dockerExec(containerId, ['mc', '--json', 'admin', 'config', 'get', 'benchmark', 'api']));
  const apiEntries = apiConfig.config?.find(entry => entry.subSystem === 'api')?.kv ?? [];
  documentStorage.staleUploads = Object.fromEntries(['stale_uploads_expiry', 'stale_uploads_cleanup_interval'].map(name => {
    const entry = apiEntries.find(value => value.key === name);
    return [name, entry?.envOverride?.value ?? entry?.value];
  }));
  if (documentStorage.staleUploads.stale_uploads_expiry !== '24h' || documentStorage.staleUploads.stale_uploads_cleanup_interval !== '6h') throw new Error('Unexpected abandoned multipart cleanup settings');
  const snapshot = {
    containerId, startedAt: inspect.State.StartedAt, image: inspect.Image,
    serverVersion: (await dockerExec(containerId, ['minio', '--version'])).trim(),
    mcVersion: (await dockerExec(containerId, ['mc', '--version'])).trim(),
    environment, config: JSON.parse(json), effective, hash: storageHash(effective),
    runtime, runtimeInfo, runtimeEnvironment,
    documentStorage: canonicalDocumentStorage(documentStorage), documentStorageRaw: documentStorage,
    documentStorageHash: storageHash(canonicalDocumentStorage(documentStorage)),
  };
  await writeFile(`${directory}/storage-${phase}.json`, JSON.stringify(snapshot, null, 2));
  await writeFile(`${directory}/storage-${phase}.txt`, text);
  return snapshot;
}

export function validateStorageRecord(record) {
  if (!record || !['off', 'on'].includes(record.mode)) throw new Error('Missing storage trial record');
  const { before, after } = record;
  for (const snapshot of [before, after]) {
    if (!snapshot || !snapshot.containerId || !snapshot.startedAt || !snapshot.image || !snapshot.serverVersion || !snapshot.mcVersion) throw new Error('Incomplete storage provenance');
    const effective = resolveStorageSettings(snapshot.config, snapshot.environment, record.mode);
    if (JSON.stringify(effective) !== JSON.stringify(snapshot.effective) || snapshot.hash !== storageHash(effective)) throw new Error('Storage configuration hash or effective values differ');
    const runtime = resolveRuntimeSettings(snapshot.runtimeInfo, snapshot.runtimeEnvironment, record.runtimeMode);
    if (JSON.stringify(runtime) !== JSON.stringify(snapshot.runtime)) throw new Error('Storage runtime provenance differs');
  }
  if (JSON.stringify(before.runtime) !== JSON.stringify(after.runtime)) throw new Error('Storage runtime changed during measurement');
  for (const key of ['containerId', 'startedAt', 'image', 'serverVersion', 'mcVersion', 'hash']) if (before[key] !== after[key]) throw new Error(`Storage ${key} changed during measurement`);
}
