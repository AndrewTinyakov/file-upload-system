import { storageRequest } from './storage-http.mjs';

export async function removeFixture(url, request = storageRequest) {
  const target = new URL(url);
  const [bucket, ...parts] = target.pathname.slice(1).split('/');
  const key = decodeURIComponent(parts.join('/'));
  if (target.origin !== 'http://minio:9000' || !['uploads', 'assets', 'documents'].includes(bucket) || !key) throw new Error('Cleanup target is outside benchmark storage');
  if (bucket !== 'documents') {
    if (target.search) throw new Error('Unexpected cleanup query');
    const response = await request({ method: 'DELETE', bucket, key });
    if (response.status !== 204) throw new Error(`Fixture cleanup returned ${response.status}`);
    return;
  }
  if (!/^documents\/[0-9A-HJKMNP-TV-Z]{26}\/(original|complete\.json)$/.test(key) || [...target.searchParams.keys()].some(name => name !== 'versionId')) throw new Error('Unexpected document cleanup target');
  const response = await request({ bucket, key: '', query: { versions: '', prefix: key, 'max-keys': '1000' } });
  if (response.status !== 200) throw new Error(`List fixture versions returned ${response.status}`);
  const xml = response.body.toString();
  if (/<IsTruncated>true<\/IsTruncated>/.test(xml)) throw new Error('Fixture version listing exceeded cleanup bound');
  for (const entry of xml.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)) {
    const objectKey = entry[2].match(/<Key>([^<]+)<\/Key>/)?.[1];
    if (objectKey !== key) continue;
    const versionId = entry[2].match(/<VersionId>([a-zA-Z0-9_-]+)<\/VersionId>/)?.[1];
    if (!versionId) throw new Error('Fixture version listing omitted a valid version ID');
    const removed = await request({ method: 'DELETE', bucket, key, query: { versionId } });
    if (removed.status !== 204) throw new Error(`Fixture version cleanup returned ${removed.status}`);
  }
}
