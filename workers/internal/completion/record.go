package completion

type Record struct {
	CommandID string    `json:"commandId"`
	AssetID   string    `json:"assetId"`
	Variants  []Variant `json:"variants"`
}

type Variant struct {
	Type            string           `json:"variantType"`
	Bucket          string           `json:"bucket"`
	ObjectKey       string           `json:"objectKey"`
	ContentType     string           `json:"contentType"`
	ByteSize        int64            `json:"byteSize"`
	PixelDimensions *PixelDimensions `json:"pixelDimensions,omitempty"`
}

type PixelDimensions struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}
