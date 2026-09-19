import { open, readFile, stat } from "node:fs/promises";
import type {
  CompletedPart,
  FileAsset,
  FileFixture,
  UploadInstructions,
  UploadSession,
} from "./types.ts";
import type { Runtime } from "./runtime.ts";

interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  expectedStatus: number;
}

interface SignedPartsResponse {
  parts: Array<{ partNumber: number; upload: UploadInstructions }>;
}

export class ApiClient {
  private readonly runtime: Runtime;
  private readonly userId: string;

  constructor(runtime: Runtime, userId = runtime.userId) {
    this.runtime = runtime;
    this.userId = userId;
  }

  forUser(userId: string): ApiClient {
    return new ApiClient(this.runtime, userId);
  }

  async ensureReachable(): Promise<void> {
    const healthUrl = new URL("../actuator/health", `${this.runtime.apiUrl}/`);
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(this.runtime.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`API health check failed with ${response.status}`);
    }
  }

  createSession(
    fixture: FileFixture,
    byteSize: number,
    idempotencyKey: string,
  ): Promise<UploadSession> {
    return this.request("/upload-sessions", {
      method: "POST",
      expectedStatus: 201,
      idempotencyKey,
      body: {
        filename: fixture.filename,
        contentType: fixture.contentType,
        byteSize,
        handlingMode: fixture.handlingMode,
      },
    });
  }

  getSession(sessionId: string): Promise<UploadSession> {
    return this.request(`/upload-sessions/${sessionId}`, {
      expectedStatus: 200,
    });
  }

  getAsset(assetId: string): Promise<FileAsset> {
    return this.request(`/assets/${assetId}`, { expectedStatus: 200 });
  }

  completeSession(
    sessionId: string,
    parts: CompletedPart[],
  ): Promise<FileAsset> {
    return this.request(`/upload-sessions/${sessionId}/complete`, {
      method: "POST",
      expectedStatus: 202,
      body: { parts },
    });
  }

  async uploadFile(
    session: UploadSession,
    filePath: string,
  ): Promise<CompletedPart[]> {
    const file = await stat(filePath);
    if (session.strategy === "SINGLE") {
      if (!session.upload)
        throw new Error("Single upload instructions are missing");
      await this.put(session.upload, await readFile(filePath));
      return [];
    }

    const partSize = session.partSize;
    const partCount = session.partCount;
    if (!partSize || !partCount)
      throw new Error("Multipart upload details are missing");

    const partNumbers = Array.from(
      { length: partCount },
      (_, index) => index + 1,
    );
    const signed = await this.request<SignedPartsResponse>(
      `/upload-sessions/${session.sessionId}/parts`,
      {
        method: "POST",
        expectedStatus: 200,
        body: { partNumbers },
      },
    );
    const handle = await open(filePath, "r");

    try {
      const completed: CompletedPart[] = [];
      for (const part of signed.parts) {
        const position = (part.partNumber - 1) * partSize;
        const length = Math.min(partSize, file.size - position);
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await handle.read(bytes, 0, length, position);
        if (bytesRead !== length)
          throw new Error(`Could not read upload part ${part.partNumber}`);
        const etag = await this.put(part.upload, bytes);
        if (!etag)
          throw new Error(
            `Storage did not return an ETag for part ${part.partNumber}`,
          );
        completed.push({ partNumber: part.partNumber, etag });
      }
      return completed;
    } finally {
      await handle.close();
    }
  }

  async download(
    url: string,
  ): Promise<{ bytes: Buffer; contentType: string | null }> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.runtime.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `Download failed with ${response.status}: ${await response.text()}`,
      );
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type"),
    };
  }

  async status(url: string): Promise<number> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.runtime.requestTimeoutMs),
    });
    await response.body?.cancel();
    return response.status;
  }

  private async put(
    instructions: UploadInstructions,
    bytes: Buffer,
  ): Promise<string> {
    const response = await fetch(instructions.url, {
      method: instructions.method,
      headers: instructions.headers,
      body: Uint8Array.from(bytes),
      signal: AbortSignal.timeout(this.runtime.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `Storage upload failed with ${response.status}: ${await response.text()}`,
      );
    }
    return response.headers.get("etag") ?? "";
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    const response = await fetch(`${this.runtime.apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        "X-User-ID": this.userId,
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { "Idempotency-Key": options.idempotencyKey }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(this.runtime.requestTimeoutMs),
    });
    const text = await response.text();
    const body = text === "" ? null : (JSON.parse(text) as unknown);
    if (response.status !== options.expectedStatus) {
      throw new Error(
        `${options.method ?? "GET"} ${path} returned ${response.status}: ${text}`,
      );
    }
    return body as T;
  }
}
