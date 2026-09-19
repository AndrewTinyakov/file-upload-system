import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApiClient } from "./api-client.ts";
import {
  assertDocumentReady,
  assertImageReady,
  assertStorageIsPrivate,
} from "./assertions.ts";
import {
  createMultipartFixture,
  documentFixture,
  imageFixtures,
  invalidImageFixture,
} from "./fixtures.ts";
import { loadRuntime } from "./runtime.ts";
import type { FileFixture } from "./types.ts";
import { uploadAndPrepare } from "./upload-flow.ts";

const runtime = loadRuntime();
const client = new ApiClient(runtime);
let temporaryDirectory: string;
let multipartFixture: FileFixture;

before(async () => {
  await client.ensureReachable();
  temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "file-upload-system-"),
  );
  multipartFixture = await createMultipartFixture(
    path.join(temporaryDirectory, "multipart-document.txt"),
    runtime.multipartBytes,
  );
});

after(async () => {
  if (temporaryDirectory)
    await rm(temporaryDirectory, { recursive: true, force: true });
});

test(
  "a document survives a single upload byte-for-byte",
  { timeout: 120_000 },
  async () => {
    const byteSize = (await stat(documentFixture.path)).size;
    const idempotencyKey = randomUUID();
    const result = await uploadAndPrepare(
      client,
      runtime,
      documentFixture,
      idempotencyKey,
    );
    const replay = await client.createSession(
      documentFixture,
      byteSize,
      idempotencyKey,
    );

    assert.equal(result.session.strategy, "SINGLE");
    assert.equal(result.acceptedAsset.status, "PREPARING");
    assert.equal(replay.sessionId, result.session.sessionId);
    assert.equal(replay.assetId, result.session.assetId);
    assert.equal(replay.status, "COMPLETED");
    await assertDocumentReady(client, result.asset, documentFixture.path);
    await assertStorageIsPrivate(client, result.session, result.asset);

    const completedAgain = await client.completeSession(
      result.session.sessionId,
      result.completedParts,
    );
    assert.deepEqual(completedAgain, result.asset);

    const foreignClient = client.forUser(runtime.foreignUserId);
    await assert.rejects(
      () => foreignClient.getAsset(result.asset.assetId),
      /returned 404/,
    );
  },
);

test(
  "a multipart document is reassembled byte-for-byte",
  { timeout: 180_000 },
  async () => {
    const result = await uploadAndPrepare(client, runtime, multipartFixture);

    assert.equal(result.session.strategy, "MULTIPART");
    assert.equal(result.completedParts.length, result.session.partCount);
    await assertDocumentReady(client, result.asset, multipartFixture.path);
  },
);

test(
  "JPEG, PNG, and WebP files produce valid image variants",
  { timeout: 180_000 },
  async (context) => {
    for (const fixture of imageFixtures) {
      await context.test(fixture.filename, async () => {
        const result = await uploadAndPrepare(client, runtime, fixture);
        await assertImageReady(client, result.asset);
        await assertStorageIsPrivate(client, result.session, result.asset);
      });
    }
  },
);

test("invalid image bytes fail preparation", { timeout: 120_000 }, async () => {
  const result = await uploadAndPrepare(client, runtime, invalidImageFixture);

  assert.equal(result.asset.status, "FAILED");
  assert.equal(result.asset.failureCode, "UNSUPPORTED_IMAGE_FORMAT");
  assert.deepEqual(result.asset.variants, []);
});
