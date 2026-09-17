package completion

import "testing"

func TestCompletedEventConvertsRecord(t *testing.T) {
	record := Record{
		CommandID: "command-1",
		AssetID:   "asset-1",
		Variants: []Variant{{
			Type:        "DISPLAY_SMALL",
			Bucket:      "assets",
			ObjectKey:   "assets/asset-1/display-480.webp",
			ContentType: "image/webp",
			ByteSize:    123,
			PixelDimensions: &PixelDimensions{
				Width:  480,
				Height: 320,
			},
		}},
	}

	event, err := CompletedEvent(record)
	if err != nil {
		t.Fatal(err)
	}
	if event.CommandId != record.CommandID || event.AssetId != record.AssetID {
		t.Fatalf("event identity = %q, %q", event.CommandId, event.AssetId)
	}
	if len(event.Variants) != 1 || event.Variants[0].VariantType == nil {
		t.Fatalf("event variants = %#v", event.Variants)
	}
	if got := event.Variants[0].VariantType.Value(); got != "DISPLAY_SMALL" {
		t.Fatalf("variant type = %v", got)
	}
	if got := event.Variants[0].PixelDimensions; got == nil || got.Width != 480 || got.Height != 320 {
		t.Fatalf("pixel dimensions = %#v", got)
	}
}

func TestCompletedEventRejectsUnknownVariantType(t *testing.T) {
	record := testRecord()
	record.Variants[0].Type = "FUTURE_VARIANT"

	if _, err := CompletedEvent(record); err == nil {
		t.Fatal("CompletedEvent() error = nil, want unsupported type error")
	}
}

func TestValidateOwnershipRejectsOutsideObjectKey(t *testing.T) {
	record := testRecord()
	record.Variants[0].ObjectKey = "other/asset-1/original"

	err := ValidateOwnership(record, "command-1", "asset-1", "assets", "assets/asset-1/")
	if err == nil {
		t.Fatal("ValidateOwnership() error = nil, want prefix error")
	}
}
