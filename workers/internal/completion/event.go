package completion

import (
	"fmt"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
)

func CompletedEvent(record Record) (messaging.AssetPreparationCompletedEventV1, error) {
	if err := validate(record); err != nil {
		return messaging.AssetPreparationCompletedEventV1{}, err
	}

	variants := make([]messaging.AssetVariantV1, 0, len(record.Variants))
	for index, variant := range record.Variants {
		variantType, ok := messaging.ValuesToAssetVariantType[variant.Type]
		if !ok {
			return messaging.AssetPreparationCompletedEventV1{}, fmt.Errorf("variant %d has unsupported type %q", index, variant.Type)
		}
		if int64(int(variant.ByteSize)) != variant.ByteSize {
			return messaging.AssetPreparationCompletedEventV1{}, fmt.Errorf("variant %d byte size exceeds platform integer range", index)
		}

		converted := messaging.AssetVariantV1{
			VariantType: &variantType,
			Bucket:      variant.Bucket,
			ObjectKey:   variant.ObjectKey,
			ContentType: variant.ContentType,
			ByteSize:    int(variant.ByteSize),
		}
		if variant.PixelDimensions != nil {
			converted.PixelDimensions = &messaging.PixelDimensionsV1{
				Width:  variant.PixelDimensions.Width,
				Height: variant.PixelDimensions.Height,
			}
		}
		variants = append(variants, converted)
	}

	return messaging.AssetPreparationCompletedEventV1{
		CommandId: record.CommandID,
		AssetId:   record.AssetID,
		Variants:  variants,
	}, nil
}
