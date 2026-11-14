import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export async function fixtures(protocol, directory) {
  await mkdir(directory, { recursive: true });
  const next = random(protocol.seed);
  const result = [];
  for (const spec of protocol.fixtures) {
    let payload;
    if (spec.format) {
      const channels = spec.alpha ? 4 : 3;
      const pixels = Buffer.alloc(spec.width * spec.height * channels);
      if (spec.compressibility === 'noise') {
        for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(next() * 256);
      } else {
        for (let i = 0; i < pixels.length; i++) pixels[i] = [64, 128, 192, 127][i % channels];
      }
      payload = await sharp(pixels, { raw: { width: spec.width, height: spec.height, channels } })
        .toFormat(spec.format, spec.format === 'jpeg' ? { quality: 90 } : {}).toBuffer();
    } else {
      payload = Buffer.alloc(spec.bytes);
      if (spec.compressibility === 'noise') {
        for (let i = 0; i < payload.length; i += 4) payload.writeUInt32LE(Math.floor(next() * 4294967296), i, true);
      } else {
        const text = Buffer.from('Seeded benchmark document. Original bytes must survive retrieval.\n');
        for (let i = 0; i < payload.length; i += text.length) text.copy(payload, i, 0, Math.min(text.length, payload.length - i));
      }
    }
    const extension = spec.format ?? 'bin';
    const name = `${spec.name}.${extension}`;
    const sha256 = createHash('sha256').update(payload).digest('hex');
    await writeFile(`${directory}/${name}`, payload);
    result.push({ ...spec, name, bytes: payload.length, type: spec.format ? `image/${spec.format}` : 'application/octet-stream', sha256 });
  }
  return result;
}
