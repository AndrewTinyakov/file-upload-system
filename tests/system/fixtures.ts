import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FileFixture } from "./types.ts";

const fixtureDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

export const documentFixture: FileFixture = {
  path: path.join(fixtureDirectory, "document.txt"),
  filename: "document.txt",
  contentType: "text/plain",
  handlingMode: "DOCUMENT",
};

export const imageFixtures: FileFixture[] = [
  ["image.jpg", "image/jpeg"],
  ["image.png", "image/png"],
  ["image.webp", "image/webp"],
].map(([filename, contentType]) => ({
  path: path.join(fixtureDirectory, filename),
  filename,
  contentType,
  handlingMode: "IMAGE" as const,
}));

export const invalidImageFixture: FileFixture = {
  path: path.join(fixtureDirectory, "invalid-image.png"),
  filename: "invalid-image.png",
  contentType: "image/png",
  handlingMode: "IMAGE",
};

export async function createMultipartFixture(
  targetPath: string,
  byteSize: number,
): Promise<FileFixture> {
  const seed = await readFile(documentFixture.path);
  const repetitions = Math.ceil((1024 * 1024) / seed.length);
  const block = Buffer.from(seed.toString("utf8").repeat(repetitions)).subarray(
    0,
    1024 * 1024,
  );
  const handle = await open(targetPath, "w");

  try {
    let written = 0;
    while (written < byteSize) {
      const chunk = block.subarray(
        0,
        Math.min(block.length, byteSize - written),
      );
      await handle.write(chunk);
      written += chunk.length;
    }
  } finally {
    await handle.close();
  }

  return {
    path: targetPath,
    filename: "multipart-document.txt",
    contentType: "text/plain",
    handlingMode: "DOCUMENT",
  };
}
