package messaging

type AssetVariantV1 struct {
	VariantType     *AssetVariantType  `json:"variantType" binding:"required"`
	Bucket          string             `json:"bucket" binding:"required"`
	ObjectKey       string             `json:"objectKey" binding:"required"`
	ContentType     string             `json:"contentType" binding:"required"`
	ByteSize        int                `json:"byteSize" binding:"required"`
	PixelDimensions *PixelDimensionsV1 `json:"pixelDimensions,omitempty"`
}
