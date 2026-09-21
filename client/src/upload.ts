import {
  CreateUploadSessionRequest,
  FileAssetControllerService,
  FileAssetResponse,
  UploadSessionControllerService,
  UploadSessionResponse,
} from './api/generated'
import type { CompletedPart, FileAssetResponse as FileAsset, UploadInstructions } from './api/generated'

const userIdStorageKey = 'file-upload-system.user-id'
const partBatchSize = 100
const pollingDelayMs = 250
const ulidAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export type UploadPhase = 'creating' | 'uploading' | 'preparing' | 'ready'

interface UploadOptions {
  file: File
  onAsset: (asset: FileAsset) => void
  onEvent: (message: string) => void
  onPhase: (phase: UploadPhase) => void
  onProgress: (progress: number) => void
}

export function getUserId(): string {
  const existing = localStorage.getItem(userIdStorageKey)
  if (existing) {
    return existing
  }

  const userId = createUlid()
  localStorage.setItem(userIdStorageKey, userId)
  return userId
}

export async function uploadFile({ file, onAsset, onEvent, onPhase, onProgress }: UploadOptions): Promise<void> {
  const userId = getUserId()
  onPhase('creating')
  onEvent('Creating session')

  const session = await UploadSessionControllerService.create(
    userId,
    crypto.randomUUID(),
    {
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      byteSize: file.size,
      handlingMode: isSupportedImage(file)
        ? CreateUploadSessionRequest.handlingMode.IMAGE
        : CreateUploadSessionRequest.handlingMode.DOCUMENT,
    },
  )

  onEvent('Session created')
  onPhase('uploading')
  onEvent(session.strategy === UploadSessionResponse.strategy.SINGLE ? 'Uploading file' : 'Uploading parts')
  const parts = await uploadParts(userId, session, file, onProgress)
  onProgress(1)
  onEvent('Upload verified')

  onPhase('preparing')
  const accepted = await UploadSessionControllerService.complete(userId, session.sessionId, { parts })
  onAsset(accepted)
  onEvent('Preparation queued')

  const asset = await waitForAsset(userId, accepted.assetId, onAsset)
  if (asset.status === FileAssetResponse.status.READY) {
    onPhase('ready')
    onEvent('Ready')
    return
  }

  throw new Error(asset.failureCode ?? `Asset ${asset.status.toLowerCase()}`)
}

async function uploadParts(
  userId: string,
  session: UploadSessionResponse,
  file: File,
  onProgress: (progress: number) => void,
): Promise<CompletedPart[]> {
  if (session.strategy === UploadSessionResponse.strategy.SINGLE) {
    if (!session.upload) {
      throw new Error('Upload instructions are missing')
    }
    await put(session.upload, file, (loaded) => onProgress(loaded / file.size))
    return []
  }

  if (!session.partSize || !session.partCount) {
    throw new Error('Multipart upload details are missing')
  }

  const completed: CompletedPart[] = []
  let uploadedBytes = 0
  const partNumbers = Array.from({ length: session.partCount }, (_, index) => index + 1)

  for (const batch of chunks(partNumbers, partBatchSize)) {
    const signed = await UploadSessionControllerService.presignParts(userId, session.sessionId, {
      partNumbers: batch,
    })

    for (const part of signed.parts) {
      const start = (part.partNumber - 1) * session.partSize
      const body = file.slice(start, Math.min(start + session.partSize, file.size))
      const etag = await put(part.upload, body, (loaded) => onProgress((uploadedBytes + loaded) / file.size))
      if (!etag) {
        throw new Error(`Part ${part.partNumber} did not return an ETag`)
      }
      uploadedBytes += body.size
      completed.push({ partNumber: part.partNumber, etag })
    }
  }

  return completed
}

async function waitForAsset(
  userId: string,
  assetId: string,
  onAsset: (asset: FileAsset) => void,
): Promise<FileAsset> {
  for (;;) {
    const asset = await FileAssetControllerService.getAsset(userId, assetId)
    onAsset(asset)
    if (
      asset.status === FileAssetResponse.status.READY ||
      asset.status === FileAssetResponse.status.FAILED ||
      asset.status === FileAssetResponse.status.DISCARDED
    ) {
      return asset
    }
    await delay(pollingDelayMs)
  }
}

function put(
  instructions: UploadInstructions,
  body: Blob,
  onProgress: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(instructions.method, instructions.url)
    Object.entries(instructions.headers)
      .filter(([name]) => name.toLowerCase() !== 'content-length')
      .forEach(([name, value]) => request.setRequestHeader(name, value))
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded)
      }
    }
    request.onerror = () => reject(new Error('Storage upload failed'))
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Storage upload returned ${request.status}`))
        return
      }
      resolve(request.getResponseHeader('etag') ?? '')
    }
    request.send(body)
  })
}

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))
}

function isSupportedImage(file: File): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
}

function createUlid(): string {
  let timestamp = Date.now()
  let encodedTimestamp = ''
  for (let index = 0; index < 10; index += 1) {
    encodedTimestamp = ulidAlphabet[timestamp % 32] + encodedTimestamp
    timestamp = Math.floor(timestamp / 32)
  }

  const randomBytes = crypto.getRandomValues(new Uint8Array(16))
  const random = Array.from(randomBytes, (byte) => ulidAlphabet[byte % 32]).join('')
  return encodedTimestamp + random
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}
