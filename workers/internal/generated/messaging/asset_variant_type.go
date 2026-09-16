package messaging

import (
	"encoding/json"
	"fmt"
)

type AssetVariantType uint

const (
	AssetVariantTypeOriginal AssetVariantType = iota
	AssetVariantTypeDisplaySmall
	AssetVariantTypeDisplayMedium
	AssetVariantTypeDisplayLarge
	AssetVariantTypeDownload
)

func (op AssetVariantType) Value() any {
	if op >= AssetVariantType(len(AssetVariantTypeValues)) {
		return nil
	}
	return AssetVariantTypeValues[op]
}

var AssetVariantTypeValues = []any{"ORIGINAL", "DISPLAY_SMALL", "DISPLAY_MEDIUM", "DISPLAY_LARGE", "DOWNLOAD"}
var ValuesToAssetVariantType = map[any]AssetVariantType{
	AssetVariantTypeValues[AssetVariantTypeOriginal]:      AssetVariantTypeOriginal,
	AssetVariantTypeValues[AssetVariantTypeDisplaySmall]:  AssetVariantTypeDisplaySmall,
	AssetVariantTypeValues[AssetVariantTypeDisplayMedium]: AssetVariantTypeDisplayMedium,
	AssetVariantTypeValues[AssetVariantTypeDisplayLarge]:  AssetVariantTypeDisplayLarge,
	AssetVariantTypeValues[AssetVariantTypeDownload]:      AssetVariantTypeDownload,
}

func (op *AssetVariantType) UnmarshalJSON(raw []byte) error {
	var value *string
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	if value == nil {
		return fmt.Errorf("AssetVariantType must be a string")
	}
	decoded, ok := ValuesToAssetVariantType[*value]
	if !ok {
		return fmt.Errorf("invalid AssetVariantType: %q", *value)
	}
	*op = decoded
	return nil
}

func (op AssetVariantType) MarshalJSON() ([]byte, error) {
	return json.Marshal(op.Value())
}
