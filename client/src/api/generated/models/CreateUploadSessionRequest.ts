/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreateUploadSessionRequest = {
    filename: string;
    contentType: string;
    byteSize: number;
    handlingMode: CreateUploadSessionRequest.handlingMode;
};
export namespace CreateUploadSessionRequest {
    export enum handlingMode {
        DOCUMENT = 'DOCUMENT',
        IMAGE = 'IMAGE',
    }
}

