package image

import (
	"reflect"
	"testing"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
)

func TestFindProfileReturnsDefaultProfile(t *testing.T) {
	got, err := FindProfile(DefaultProfileName, DefaultProfileVersion)
	if err != nil {
		t.Fatalf("FindProfile() error = %v", err)
	}

	want := Profile{
		Name:    DefaultProfileName,
		Version: DefaultProfileVersion,
		Variants: []VariantSpec{
			{Type: messaging.AssetVariantTypeDisplaySmall, MaxWidth: 480, Encoding: DisplayWebP},
			{Type: messaging.AssetVariantTypeDisplayMedium, MaxWidth: 1280, Encoding: DisplayWebP},
			{Type: messaging.AssetVariantTypeDisplayLarge, MaxWidth: 1920, Encoding: DisplayWebP},
			{Type: messaging.AssetVariantTypeDownload, Encoding: DownloadJpegOrPng},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("FindProfile() = %#v, want %#v", got, want)
	}
}
