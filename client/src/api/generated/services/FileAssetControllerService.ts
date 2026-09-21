/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FileAssetResponse } from '../models/FileAssetResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class FileAssetControllerService {
    /**
     * @param xUserId
     * @param assetId
     * @returns FileAssetResponse OK
     * @throws ApiError
     */
    public static getAsset(
        xUserId: string,
        assetId: string,
    ): CancelablePromise<FileAssetResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v1/assets/{assetId}',
            path: {
                'assetId': assetId,
            },
            headers: {
                'X-User-ID': xUserId,
            },
        });
    }
}
