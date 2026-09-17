package completion

import (
	"fmt"
	"strings"
)

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

func ValidateOwnership(record Record, commandID, assetID, bucket, prefix string) error {
	if err := validate(record); err != nil {
		return err
	}
	if record.CommandID != commandID {
		return fmt.Errorf("completion record command ID %q does not match %q", record.CommandID, commandID)
	}
	if record.AssetID != assetID {
		return fmt.Errorf("completion record asset ID %q does not match %q", record.AssetID, assetID)
	}
	if !strings.HasSuffix(prefix, "/") {
		return fmt.Errorf("destination prefix must end with a slash")
	}
	for index, variant := range record.Variants {
		if variant.Bucket != bucket {
			return fmt.Errorf("variant %d bucket %q does not match %q", index, variant.Bucket, bucket)
		}
		if !strings.HasPrefix(variant.ObjectKey, prefix) || variant.ObjectKey == prefix {
			return fmt.Errorf("variant %d object key %q is outside destination prefix %q", index, variant.ObjectKey, prefix)
		}
	}
	return nil
}
