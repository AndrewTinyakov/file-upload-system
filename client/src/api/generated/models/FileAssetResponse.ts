/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetVariantResponse } from './AssetVariantResponse';
export type FileAssetResponse = {
    assetId: string;
    filename: string;
    contentType: string;
    byteSize: number;
    handlingMode: FileAssetResponse.handlingMode;
    status: FileAssetResponse.status;
    failureCode?: string | null;
    variants: Array<AssetVariantResponse>;
};
export namespace FileAssetResponse {
    export enum handlingMode {
        DOCUMENT = 'DOCUMENT',
        IMAGE = 'IMAGE',
    }
    export enum status {
        AWAITING_UPLOAD = 'AWAITING_UPLOAD',
        PREPARING = 'PREPARING',
        READY = 'READY',
        FAILED = 'FAILED',
        DISCARDED = 'DISCARDED',
    }
}

