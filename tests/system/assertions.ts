import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { ApiClient } from "./api-client.ts";
import type { FileAsset, UploadSession } from "./types.ts";

export async function assertDocumentReady(
  client: ApiClient,
  asset: FileAsset,
  sourcePath: string,
): Promise<void> {
  assert.equal(asset.status, "READY");
  assert.equal(asset.variants.length, 1);
  assert.equal(asset.variants[0]?.variantType, "ORIGINAL");

  const downloaded = await client.download(asset.variants[0].url);
  assert.equal(downloaded.contentType, asset.variants[0].contentType);
  assert.equal(downloaded.bytes.length, asset.variants[0].byteSize);
  assert.deepEqual(downloaded.bytes, await readFile(sourcePath));
}

export async function assertImageReady(
  client: ApiClient,
  asset: FileAsset,
): Promise<void> {
  assert.equal(asset.status, "READY");
  assert.deepEqual(
    asset.variants.map((variant) => variant.variantType).sort(),
    ["DISPLAY_LARGE", "DISPLAY_MEDIUM", "DISPLAY_SMALL", "DOWNLOAD"],
  );

  for (const variant of asset.variants) {
    const downloaded = await client.download(variant.url);
    const metadata = await sharp(downloaded.bytes).metadata();
    assert.equal(downloaded.contentType, variant.contentType);
    assert.equal(downloaded.bytes.length, variant.byteSize);
    assert.equal(metadata.width, variant.width);
    assert.equal(metadata.height, variant.height);
    assert.ok((variant.width ?? 0) > 0);
    assert.ok((variant.height ?? 0) > 0);
  }
}

export async function assertStorageIsPrivate(
  client: ApiClient,
  session: UploadSession,
  asset: FileAsset,
): Promise<void> {
  const sourceUrl = session.upload?.url;
  if (sourceUrl) {
    const unsignedSourceUrl = new URL(sourceUrl);
    unsignedSourceUrl.search = "";
    assert.equal(await client.status(unsignedSourceUrl.toString()), 403);
  }

  const completionUrl = new URL(asset.variants[0].url);
  completionUrl.pathname = completionUrl.pathname.replace(
    /\/[^/]+$/,
    "/complete.json",
  );
  completionUrl.search = "";
  assert.equal(await client.status(completionUrl.toString()), 403);
}
