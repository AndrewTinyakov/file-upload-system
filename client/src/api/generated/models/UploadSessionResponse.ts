/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UploadInstructions } from './UploadInstructions';
export type UploadSessionResponse = {
    sessionId: string;
    assetId: string;
    strategy: UploadSessionResponse.strategy;
    status: UploadSessionResponse.status;
    expiresAt: string;
    upload?: (UploadInstructions | null);
    partSize?: number | null;
    partCount?: number | null;
};
export namespace UploadSessionResponse {
    export enum strategy {
        SINGLE = 'SINGLE',
        MULTIPART = 'MULTIPART',
    }
    export enum status {
        CREATED = 'CREATED',
        COMPLETED = 'COMPLETED',
        ABORTED = 'ABORTED',
        EXPIRED = 'EXPIRED',
    }
}

