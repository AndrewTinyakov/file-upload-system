export type HandlingMode = "DOCUMENT" | "IMAGE";
export type UploadStrategy = "SINGLE" | "MULTIPART";
export type SessionStatus = "CREATED" | "COMPLETED" | "ABORTED" | "EXPIRED";
export type AssetStatus =
  | "AWAITING_UPLOAD"
  | "PREPARING"
  | "READY"
  | "FAILED"
  | "DISCARDED";

export interface UploadInstructions {
  url: string;
  method: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface UploadSession {
  sessionId: string;
  assetId: string;
  strategy: UploadStrategy;
  status: SessionStatus;
  expiresAt: string;
  upload?: UploadInstructions;
  partSize?: number;
  partCount?: number;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface AssetVariant {
  variantType:
    | "ORIGINAL"
    | "DISPLAY_SMALL"
    | "DISPLAY_MEDIUM"
    | "DISPLAY_LARGE"
    | "DOWNLOAD";
  url: string;
  contentType: string;
  byteSize: number;
  width?: number;
  height?: number;
}

export interface FileAsset {
  assetId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  handlingMode: HandlingMode;
  status: AssetStatus;
  failureCode?: string;
  variants: AssetVariant[];
}

export interface FileFixture {
  path: string;
  filename: string;
  contentType: string;
  handlingMode: HandlingMode;
}

export interface UploadResult {
  session: UploadSession;
  completedParts: CompletedPart[];
  acceptedAsset: FileAsset;
  asset: FileAsset;
}
