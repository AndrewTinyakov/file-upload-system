package image

import (
	"fmt"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
)

const (
	DefaultProfileName    = "default-image"
	DefaultProfileVersion = 1
)

type Encoding string

const (
	DisplayWebP       Encoding = "WEBP"
	DownloadJpegOrPng Encoding = "JPEG_OR_PNG"
)

type VariantSpec struct {
	Type     messaging.AssetVariantType
	MaxWidth int
	Encoding Encoding
}

type Profile struct {
	Name     string
	Version  int
	Variants []VariantSpec
}

var defaultProfileV1 = Profile{
	Name:    DefaultProfileName,
	Version: DefaultProfileVersion,
	Variants: []VariantSpec{
		{Type: messaging.AssetVariantTypeDisplaySmall, MaxWidth: 480, Encoding: DisplayWebP},
		{Type: messaging.AssetVariantTypeDisplayMedium, MaxWidth: 1280, Encoding: DisplayWebP},
		{Type: messaging.AssetVariantTypeDisplayLarge, MaxWidth: 1920, Encoding: DisplayWebP},
		{Type: messaging.AssetVariantTypeDownload, Encoding: DownloadJpegOrPng},
	},
}

func FindProfile(name string, version int) (Profile, error) {
	if name != defaultProfileV1.Name || version != defaultProfileV1.Version {
		return Profile{}, fmt.Errorf("unknown processing profile %q version %d", name, version)
	}

	profile := defaultProfileV1
	profile.Variants = append([]VariantSpec(nil), defaultProfileV1.Variants...)
	return profile, nil
}
