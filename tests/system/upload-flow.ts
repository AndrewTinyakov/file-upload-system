import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import type { ApiClient } from "./api-client.ts";
import type { Runtime } from "./runtime.ts";
import type { FileAsset, FileFixture, UploadResult } from "./types.ts";

export async function uploadAndPrepare(
  client: ApiClient,
  runtime: Runtime,
  fixture: FileFixture,
  idempotencyKey = randomUUID(),
): Promise<UploadResult> {
  const byteSize = (await stat(fixture.path)).size;
  const session = await client.createSession(fixture, byteSize, idempotencyKey);
  const completedParts = await client.uploadFile(session, fixture.path);
  const acceptedAsset = await client.completeSession(
    session.sessionId,
    completedParts,
  );
  const asset = await waitForTerminalAsset(client, runtime, session.assetId);
  return { session, completedParts, acceptedAsset, asset };
}

async function waitForTerminalAsset(
  client: ApiClient,
  runtime: Runtime,
  assetId: string,
): Promise<FileAsset> {
  const deadline = Date.now() + runtime.processingTimeoutMs;
  const observations: string[] = [];

  while (Date.now() <= deadline) {
    const asset = await client.getAsset(assetId);
    observations.push(asset.status);
    if (
      asset.status === "READY" ||
      asset.status === "FAILED" ||
      asset.status === "DISCARDED"
    )
      return asset;
    await wait(runtime.pollIntervalMs);
  }

  throw new Error(
    `Asset ${assetId} did not reach a terminal state: ${observations.join(" -> ")}`,
  );
}
