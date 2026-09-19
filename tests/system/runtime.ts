const defaultUserId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const defaultForeignUserId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

export interface Runtime {
  apiUrl: string;
  userId: string;
  foreignUserId: string;
  requestTimeoutMs: number;
  processingTimeoutMs: number;
  pollIntervalMs: number;
  multipartBytes: number;
}

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadRuntime(): Runtime {
  const apiUrl = (
    process.env.SYSTEM_TEST_API_URL ?? "http://localhost:8080/api/v1"
  ).replace(/\/$/, "");
  const hostname = new URL(apiUrl).hostname;
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  if (
    !localHosts.has(hostname) &&
    process.env.ALLOW_REMOTE_SYSTEM_TESTS !== "true"
  ) {
    throw new Error(
      "Set ALLOW_REMOTE_SYSTEM_TESTS=true to run against a non-local API",
    );
  }

  return {
    apiUrl,
    userId: process.env.SYSTEM_TEST_USER_ID ?? defaultUserId,
    foreignUserId:
      process.env.SYSTEM_TEST_FOREIGN_USER_ID ?? defaultForeignUserId,
    requestTimeoutMs: positiveInteger("SYSTEM_TEST_REQUEST_TIMEOUT_MS", 60_000),
    processingTimeoutMs: positiveInteger(
      "SYSTEM_TEST_PROCESSING_TIMEOUT_MS",
      90_000,
    ),
    pollIntervalMs: positiveInteger("SYSTEM_TEST_POLL_INTERVAL_MS", 250),
    multipartBytes: positiveInteger(
      "SYSTEM_TEST_MULTIPART_BYTES",
      64 * 1024 * 1024,
    ),
  };
}
