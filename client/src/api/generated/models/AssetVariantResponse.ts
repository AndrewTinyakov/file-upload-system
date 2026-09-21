/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AssetVariantResponse = {
    variantType: AssetVariantResponse.variantType;
    url: string;
    contentType: string;
    byteSize: number;
    width?: number | null;
    height?: number | null;
};
export namespace AssetVariantResponse {
    export enum variantType {
        ORIGINAL = 'ORIGINAL',
        DISPLAY_SMALL = 'DISPLAY_SMALL',
        DISPLAY_MEDIUM = 'DISPLAY_MEDIUM',
        DISPLAY_LARGE = 'DISPLAY_LARGE',
        DOWNLOAD = 'DOWNLOAD',
    }
}

