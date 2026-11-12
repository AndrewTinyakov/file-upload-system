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
const partConcurrency = 4
const transferConcurrency = 4
const waitingTransfers: Array<() => void> = []
let activeTransfers = 0
const pollingDelayMs = 250
const ulidAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export type UploadPhase = 'creating' | 'uploading' | 'preparing' | 'ready'

interface UploadOptions {
  file: File
  signal?: AbortSignal
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

export async function uploadFile({ file, signal, onAsset, onEvent, onPhase, onProgress }: UploadOptions): Promise<void> {
  signal?.throwIfAborted()
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
  const parts = await uploadParts(userId, session, file, onProgress, signal)
  signal?.throwIfAborted()
  onProgress(1)
  onEvent('Upload verified')

  onPhase('preparing')
  const accepted = await UploadSessionControllerService.complete(userId, session.sessionId, { parts })
  signal?.throwIfAborted()
  onAsset(accepted)
  onEvent('Preparation queued')

  const asset = await waitForAsset(userId, accepted.assetId, onAsset, signal)
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
  signal?: AbortSignal,
): Promise<CompletedPart[]> {
  signal?.throwIfAborted()
  if (session.strategy === UploadSessionResponse.strategy.SINGLE) {
    if (!session.upload) {
      throw new Error('Upload instructions are missing')
    }
    const instructions = session.upload
    await withTransferSlot(() => put(instructions, file, (loaded) => onProgress(loaded / file.size), signal), signal)
    return []
  }

  if (!session.partSize || !session.partCount) {
    throw new Error('Multipart upload details are missing')
  }

  const partSize = session.partSize
  const completed: CompletedPart[] = []
  let uploadedBytes = 0
  const loadedBytes = Array<number>(session.partCount).fill(0)
  const partNumbers = Array.from({ length: session.partCount }, (_, index) => index + 1)

  for (const batch of chunks(partNumbers, partBatchSize)) {
    signal?.throwIfAborted()
    const signed = await UploadSessionControllerService.presignParts(userId, session.sessionId, {
      partNumbers: batch,
    })

    let nextPart = 0
    let failed = false
    let failure: unknown
    const fail = (error: unknown): never => {
      if (!failed) {
        failed = true
        failure = error
      }
      throw error
    }
    const uploadNext = async (): Promise<void> => {
      while (!failed && nextPart < signed.parts.length) {
        const part = signed.parts[nextPart++]
        const start = (part.partNumber - 1) * partSize
        const body = file.slice(start, Math.min(start + partSize, file.size))
        const updateProgress = (loaded: number) => {
          uploadedBytes += loaded - loadedBytes[part.partNumber - 1]
          loadedBytes[part.partNumber - 1] = loaded
          onProgress(uploadedBytes / file.size)
        }
        try {
          const etag = await withTransferSlot(async () => {
            if (failed) {
              throw failure
            }
            try {
              const etag = await put(part.upload, body, updateProgress, signal)
              if (!etag) {
                throw new Error(`Part ${part.partNumber} did not return an ETag`)
              }
              return etag
            } catch (error) {
              return fail(error)
            }
          }, signal)
          updateProgress(body.size)
          completed.push({ partNumber: part.partNumber, etag })
        } catch (error) {
          fail(error)
        }
      }
    }
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(partConcurrency, signed.parts.length) }, uploadNext),
    )
    const rejection = results.find((result) => result.status === 'rejected')
    if (rejection?.status === 'rejected') {
      throw rejection.reason
    }
  }

  return completed.sort((left, right) => left.partNumber - right.partNumber)
}

async function waitForAsset(
  userId: string,
  assetId: string,
  onAsset: (asset: FileAsset) => void,
  signal?: AbortSignal,
): Promise<FileAsset> {
  for (;;) {
    signal?.throwIfAborted()
    const asset = await FileAssetControllerService.getAsset(userId, assetId)
    signal?.throwIfAborted()
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

async function withTransferSlot<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  if (activeTransfers < transferConcurrency) {
    activeTransfers += 1
  } else {
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => {
        const index = waitingTransfers.indexOf(start)
        if (index >= 0) waitingTransfers.splice(index, 1)
        reject(signal?.reason)
      }
      waitingTransfers.push(start)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }
  try {
    signal?.throwIfAborted()
    return await operation()
  } finally {
    const next = waitingTransfers.shift()
    if (next) {
      next()
    } else {
      activeTransfers -= 1
    }
  }
}

function put(
  instructions: UploadInstructions,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  let abort = () => {}
  return new Promise<string>((resolve, reject) => {
    signal?.throwIfAborted()
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
    request.onabort = () => reject(signal?.reason ?? new Error('Storage upload aborted'))
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Storage upload returned ${request.status}`))
        return
      }
      resolve(request.getResponseHeader('etag') ?? '')
    }
    abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    request.send(body)
  }).finally(() => signal?.removeEventListener('abort', abort))
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
