import type { FileAssetResponse } from '../api/generated'

export type UploadPhase = 'idle' | 'creating' | 'uploading' | 'preparing' | 'ready' | 'failed'

export interface UploadEvent {
  at: Date
  message: string
}

export type FileAsset = FileAssetResponse
