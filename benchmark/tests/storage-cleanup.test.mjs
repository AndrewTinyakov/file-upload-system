import test from 'node:test';
import assert from 'node:assert/strict';
import { removeFixture } from '../src/storage.mjs';

const key = 'documents/01ARZ3NDEKTSV4RRFFQ69G5FAV/original';
const target = `http://minio:9000/documents/${key}`;

test('versioned cleanup removes data and delete markers for exactly its own key', async () => {
  const calls = [];
  await removeFixture(`${target}?versionId=v1`, async input => {
    calls.push(input);
    if (input.method === 'DELETE') return { status: 204 };
    return { status: 200, body: Buffer.from(`<ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>${key}</Key><VersionId>v1</VersionId></Version><DeleteMarker><Key>${key}</Key><VersionId>v2</VersionId></DeleteMarker><Version><Key>${key}-neighbor</Key><VersionId>v3</VersionId></Version></ListVersionsResult>`) };
  });
  assert.deepEqual(calls.filter(call => call.method === 'DELETE'), [
    { method: 'DELETE', bucket: 'documents', key, query: { versionId: 'v1' } },
    { method: 'DELETE', bucket: 'documents', key, query: { versionId: 'v2' } },
  ]);
});

test('cleanup rejects foreign hosts, buckets, document keys and query capabilities', async () => {
  for (const url of ['http://example.com/assets/file', 'http://minio:9000/private/file', 'http://minio:9000/documents/unrelated', `${target}?uploadId=x`]) {
    await assert.rejects(removeFixture(url, () => { throw new Error('Unexpected storage call'); }), /Cleanup target|Unexpected document/);
  }
});

test('cleanup reports an incomplete listing or failed version deletion', async () => {
  await assert.rejects(removeFixture(target, async () => ({ status: 200, body: Buffer.from('<IsTruncated>true</IsTruncated>') })), /exceeded cleanup bound/);
  await assert.rejects(removeFixture(target, async input => input.method === 'DELETE' ? { status: 503 } : { status: 200, body: Buffer.from(`<Version><Key>${key}</Key><VersionId>v1</VersionId></Version>`) }), /returned 503/);
});
