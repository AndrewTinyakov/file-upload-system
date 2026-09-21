/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CompleteUploadSessionRequest } from '../models/CompleteUploadSessionRequest';
import type { CreateUploadSessionRequest } from '../models/CreateUploadSessionRequest';
import type { FileAssetResponse } from '../models/FileAssetResponse';
import type { SignedPartsResponse } from '../models/SignedPartsResponse';
import type { SignPartsRequest } from '../models/SignPartsRequest';
import type { UploadSessionResponse } from '../models/UploadSessionResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class UploadSessionControllerService {
    /**
     * @param xUserId
     * @param idempotencyKey
     * @param requestBody
     * @returns UploadSessionResponse Created
     * @throws ApiError
     */
    public static create(
        xUserId: string,
        idempotencyKey: string,
        requestBody: CreateUploadSessionRequest,
    ): CancelablePromise<UploadSessionResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v1/upload-sessions',
            headers: {
                'X-User-ID': xUserId,
                'Idempotency-Key': idempotencyKey,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * @param xUserId
     * @param sessionId
     * @param requestBody
     * @returns SignedPartsResponse OK
     * @throws ApiError
     */
    public static presignParts(
        xUserId: string,
        sessionId: string,
        requestBody: SignPartsRequest,
    ): CancelablePromise<SignedPartsResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v1/upload-sessions/{sessionId}/parts',
            path: {
                'sessionId': sessionId,
            },
            headers: {
                'X-User-ID': xUserId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * @param xUserId
     * @param sessionId
     * @param requestBody
     * @returns FileAssetResponse Accepted
     * @throws ApiError
     */
    public static complete(
        xUserId: string,
        sessionId: string,
        requestBody?: CompleteUploadSessionRequest,
    ): CancelablePromise<FileAssetResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v1/upload-sessions/{sessionId}/complete',
            path: {
                'sessionId': sessionId,
            },
            headers: {
                'X-User-ID': xUserId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * @param xUserId
     * @param sessionId
     * @returns UploadSessionResponse OK
     * @throws ApiError
     */
    public static abort(
        xUserId: string,
        sessionId: string,
    ): CancelablePromise<UploadSessionResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v1/upload-sessions/{sessionId}/abort',
            path: {
                'sessionId': sessionId,
            },
            headers: {
                'X-User-ID': xUserId,
            },
        });
    }
    /**
     * @param xUserId
     * @param sessionId
     * @returns UploadSessionResponse OK
     * @throws ApiError
     */
    public static getSession(
        xUserId: string,
        sessionId: string,
    ): CancelablePromise<UploadSessionResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v1/upload-sessions/{sessionId}',
            path: {
                'sessionId': sessionId,
            },
            headers: {
                'X-User-ID': xUserId,
            },
        });
    }
}
