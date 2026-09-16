package messagecodec

import (
	"bytes"
	"reflect"
	"testing"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
)

const prepareDocumentCommandJSON = `{"commandId":"01K50V1X8QR5SM1QYQ5B3M7W9A","assetId":"01K50V1X8QR5SM1QYQ5B3M7W9B","sourceBucket":"uploads","sourceObjectKey":"incoming/report.pdf","sourceContentType":"application/pdf","sourceByteSize":2048,"sourceObjectEtag":"opaque-etag","destinationBucket":"assets","destinationPrefix":"assets/01K50V1X8QR5SM1QYQ5B3M7W9B/"}`

const prepareImageCommandJSON = `{"commandId":"01K50V1X8QR5SM1QYQ5B3M7W9A","assetId":"01K50V1X8QR5SM1QYQ5B3M7W9B","sourceBucket":"uploads","sourceObjectKey":"incoming/image.png","sourceContentType":"image/png","sourceByteSize":1099511627776,"sourceObjectEtag":"opaque-etag","destinationBucket":"assets","destinationPrefix":"assets/01K50V1X8QR5SM1QYQ5B3M7W9B/","processingProfileName":"default-image","processingProfileVersion":1}`

const completionEventWithoutPixelDimensionsJSON = `{"commandId":"01K50V1X8QR5SM1QYQ5B3M7W9A","assetId":"01K50V1X8QR5SM1QYQ5B3M7W9B","variants":[{"variantType":"ORIGINAL","bucket":"assets","objectKey":"assets/01K50V1X8QR5SM1QYQ5B3M7W9B/original","contentType":"application/pdf","byteSize":1024}]}`

const preparationFailedEventJSON = `{"commandId":"01K50V1X8QR5SM1QYQ5B3M7W9A","assetId":"01K50V1X8QR5SM1QYQ5B3M7W9B","failureCode":"INVALID_IMAGE"}`

func TestEncodePrepareDocumentCommand(t *testing.T) {
	payload, err := Encode(prepareDocumentCommand())
	if err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	if string(payload) != prepareDocumentCommandJSON {
		t.Fatalf("Encode() = %s, want %s", payload, prepareDocumentCommandJSON)
	}
}

func TestDecodePrepareDocumentCommand(t *testing.T) {
	got, err := Decode[messaging.PrepareDocumentCommandV1]([]byte(prepareDocumentCommandJSON))
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if want := prepareDocumentCommand(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Decode() = %#v, want %#v", got, want)
	}
}

func TestDecodePrepareImageCommandPreservesLargeByteSize(t *testing.T) {
	got, err := Decode[messaging.PrepareImageCommandV1]([]byte(prepareImageCommandJSON))
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if got.SourceByteSize != 1<<40 {
		t.Fatalf("SourceByteSize = %d, want %d", got.SourceByteSize, 1<<40)
	}
}

func TestEncodeCompletionEventOmitsAbsentPixelDimensions(t *testing.T) {
	payload, err := Encode(completionEventWithoutPixelDimensions())
	if err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	if bytes.Contains(payload, []byte("pixelDimensions")) {
		t.Fatalf("Encode() included absent pixelDimensions: %s", payload)
	}
}

func TestDecodeCompletionEventLeavesAbsentPixelDimensionsNil(t *testing.T) {
	got, err := Decode[messaging.AssetPreparationCompletedEventV1]([]byte(completionEventWithoutPixelDimensionsJSON))
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if got.Variants[0].PixelDimensions != nil {
		t.Fatalf("PixelDimensions = %#v, want nil", got.Variants[0].PixelDimensions)
	}
}

func TestVariantTypeWireValues(t *testing.T) {
	want := map[messaging.AssetVariantType]string{
		messaging.AssetVariantTypeOriginal:      `"ORIGINAL"`,
		messaging.AssetVariantTypeDisplaySmall:  `"DISPLAY_SMALL"`,
		messaging.AssetVariantTypeDisplayMedium: `"DISPLAY_MEDIUM"`,
		messaging.AssetVariantTypeDisplayLarge:  `"DISPLAY_LARGE"`,
		messaging.AssetVariantTypeDownload:      `"DOWNLOAD"`,
	}

	for variantType, encoded := range want {
		payload, err := Encode(variantType)
		if err != nil {
			t.Fatalf("Encode(%v) error = %v", variantType, err)
		}
		if string(payload) != encoded {
			t.Fatalf("Encode(%v) = %s, want %s", variantType, payload, encoded)
		}
		decoded, err := Decode[messaging.AssetVariantType]([]byte(encoded))
		if err != nil || decoded != variantType {
			t.Fatalf("Decode(%s) = %v, %v, want %v", encoded, decoded, err, variantType)
		}
	}
}

func TestEncodePreparationFailedEvent(t *testing.T) {
	payload, err := Encode(preparationFailedEvent())
	if err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	if string(payload) != preparationFailedEventJSON {
		t.Fatalf("Encode() = %s, want %s", payload, preparationFailedEventJSON)
	}
}

func TestDecodePreparationFailedEvent(t *testing.T) {
	got, err := Decode[messaging.AssetPreparationFailedEventV1]([]byte(preparationFailedEventJSON))
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if want := preparationFailedEvent(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Decode() = %#v, want %#v", got, want)
	}
}

func TestDecodeRejectsInvalidVariantTypes(t *testing.T) {
	for _, raw := range []string{`"FUTURE_VARIANT"`, `""`, `0`, `true`, `null`, `{}`, `[]`} {
		t.Run(raw, func(t *testing.T) {
			if _, err := Decode[messaging.AssetVariantType]([]byte(raw)); err == nil {
				t.Fatal("Decode() error = nil, want invalid enum error")
			}
		})
	}
}

func TestDecodeRejectsUnknownFields(t *testing.T) {
	payload := []byte(`{"commandId":"01K50V1X8QR5SM1QYQ5B3M7W9A","unexpected":true}`)

	if _, err := Decode[messaging.AssetPreparationFailedEventV1](payload); err == nil {
		t.Fatal("Decode() error = nil, want unknown-field error")
	}
}

func prepareDocumentCommand() messaging.PrepareDocumentCommandV1 {
	return messaging.PrepareDocumentCommandV1{
		CommandId:         "01K50V1X8QR5SM1QYQ5B3M7W9A",
		AssetId:           "01K50V1X8QR5SM1QYQ5B3M7W9B",
		SourceBucket:      "uploads",
		SourceObjectKey:   "incoming/report.pdf",
		SourceContentType: "application/pdf",
		SourceByteSize:    2048,
		SourceObjectEtag:  "opaque-etag",
		DestinationBucket: "assets",
		DestinationPrefix: "assets/01K50V1X8QR5SM1QYQ5B3M7W9B/",
	}
}

func completionEventWithoutPixelDimensions() messaging.AssetPreparationCompletedEventV1 {
	variantType := messaging.AssetVariantTypeOriginal
	return messaging.AssetPreparationCompletedEventV1{
		CommandId: "01K50V1X8QR5SM1QYQ5B3M7W9A",
		AssetId:   "01K50V1X8QR5SM1QYQ5B3M7W9B",
		Variants: []messaging.AssetVariantV1{{
			VariantType: &variantType,
			Bucket:      "assets",
			ObjectKey:   "assets/01K50V1X8QR5SM1QYQ5B3M7W9B/original",
			ContentType: "application/pdf",
			ByteSize:    1024,
		}},
	}
}

func preparationFailedEvent() messaging.AssetPreparationFailedEventV1 {
	return messaging.AssetPreparationFailedEventV1{
		CommandId:   "01K50V1X8QR5SM1QYQ5B3M7W9A",
		AssetId:     "01K50V1X8QR5SM1QYQ5B3M7W9B",
		FailureCode: "INVALID_IMAGE",
	}
}
