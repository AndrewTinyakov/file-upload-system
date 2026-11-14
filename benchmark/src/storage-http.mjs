import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export function storageRequest({ method = 'GET', bucket, key, query = {}, headers = {}, body = Buffer.alloc(0) }) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const path = `/${encode(bucket)}/${key.split('/').map(encode).join('/')}`;
  const search = Object.entries(query).map(([name, value]) => [encode(name), encode(String(value))])
    .sort(([left, valueLeft], [right, valueRight]) => left < right ? -1 : left > right ? 1 : valueLeft < valueRight ? -1 : valueLeft > valueRight ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`).join('&');
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const payloadHash = sha256(payload);
  const signed = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')]));
  Object.assign(signed, { host: 'minio:9000', 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp });
  const names = Object.keys(signed).sort();
  const signedHeaders = names.join(';');
  const canonical = `${method}\n${path}\n${search}\n${names.map(name => `${name}:${signed[name]}\n`).join('')}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/us-east-1/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac('AWS4file_upload', date), 'us-east-1'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`).digest('hex');
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: 'minio', port: 9000, method, path: `${path}${search ? `?${search}` : ''}`, headers: {
      ...signed,
      'content-length': payload.length,
      authorization: `AWS4-HMAC-SHA256 Credential=file_upload/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks), durationMs: performance.now() - started }));
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('Storage request timeout')));
    request.end(payload);
  });
}
