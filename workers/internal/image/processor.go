package image

import (
	"bytes"
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/completion"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/objectstore"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/davidbyttow/govips/v2/vips"
)

var supportedImageTypes = [...]vips.ImageType{
	vips.ImageTypeJPEG,
	vips.ImageTypePNG,
	vips.ImageTypeWEBP,
}

type Client interface {
	HeadObject(context.Context, *s3.HeadObjectInput, ...func(*s3.Options)) (*s3.HeadObjectOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

type Processor struct {
	client Client
	store  completion.Store
}

func NewProcessor(client Client) Processor {
	return Processor{client: client, store: completion.NewStore(client)}
}

func (processor Processor) Process(
	ctx context.Context,
	command messaging.PrepareImageCommandV1,
) (completion.Record, error) {
	if err := validateCommand(command); err != nil {
		return completion.Record{}, err
	}

	record, err := processor.store.Load(ctx, command.DestinationBucket, command.DestinationPrefix)
	if err != nil {
		return completion.Record{}, err
	}
	if record != nil {
		if err := validateRecord(*record, command); err != nil {
			return completion.Record{}, fmt.Errorf("validate existing completion record: %w", err)
		}
		return *record, nil
	}

	profile, err := FindProfile(command.ProcessingProfileName, command.ProcessingProfileVersion)
	if err != nil {
		return completion.Record{}, worker.Permanent(worker.FailureUnknownProfile, err)
	}
	source := objectstore.Source{
		Bucket:      command.SourceBucket,
		ObjectKey:   command.SourceObjectKey,
		ContentType: command.SourceContentType,
		ByteSize:    int64(command.SourceByteSize),
		ObjectETag:  command.SourceObjectEtag,
	}
	if err := objectstore.VerifySource(ctx, processor.client, source); err != nil {
		return completion.Record{}, err
	}
	payload, err := objectstore.ReadSource(ctx, processor.client, source)
	if err != nil {
		return completion.Record{}, err
	}

	imageType := vips.DetermineImageType(payload)
	if !isSupportedImageType(imageType) {
		return completion.Record{}, worker.Permanent(
			worker.FailureUnsupportedImageFormat,
			fmt.Errorf("detected image type %q", vips.ImageTypes[imageType]),
		)
	}

	params := vips.NewImportParams()
	params.AutoRotate.Set(true)
	image, err := vips.LoadImageFromBuffer(payload, params)
	if err != nil {
		return completion.Record{}, worker.Permanent(worker.FailureInvalidImage, fmt.Errorf("decode image: %w", err))
	}
	defer image.Close()
	if !isValidImage(image) {
		return completion.Record{}, worker.Permanent(
			worker.FailureInvalidImage,
			fmt.Errorf("image must be static and have positive dimensions"),
		)
	}

	variants, err := processor.writeVariants(ctx, command, profile, image)
	if err != nil {
		return completion.Record{}, err
	}
	result := completion.Record{CommandID: command.CommandId, AssetID: command.AssetId, Variants: variants}
	if err := processor.store.Save(ctx, command.DestinationBucket, command.DestinationPrefix, result); err != nil {
		return completion.Record{}, err
	}
	return result, nil
}

func (processor Processor) writeVariants(
	ctx context.Context,
	command messaging.PrepareImageCommandV1,
	profile Profile,
	image *vips.ImageRef,
) ([]completion.Variant, error) {
	variants := make([]completion.Variant, 0, len(profile.Variants))
	displays := make(map[int]completion.Variant)
	transparent := image.HasAlpha()

	for _, spec := range profile.Variants {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		switch spec.Encoding {
		case DisplayWebP:
			width := min(image.Width(), spec.MaxWidth)
			variant, ok := displays[width]
			if !ok {
				written, err := processor.writeDisplay(ctx, command, image, width)
				if err != nil {
					return nil, err
				}
				variant = written
				displays[width] = variant
			}
			variant.Type = spec.Type.Value().(string)
			variants = append(variants, variant)
		case DownloadJpegOrPng:
			variant, err := processor.writeDownload(ctx, command, image, transparent)
			if err != nil {
				return nil, err
			}
			variant.Type = spec.Type.Value().(string)
			variants = append(variants, variant)
		default:
			return nil, fmt.Errorf("unsupported image variant encoding %q", spec.Encoding)
		}
	}
	return variants, nil
}

func (processor Processor) writeDisplay(
	ctx context.Context,
	command messaging.PrepareImageCommandV1,
	source *vips.ImageRef,
	width int,
) (completion.Variant, error) {
	image, err := source.Copy()
	if err != nil {
		return completion.Variant{}, fmt.Errorf("copy image for display variant: %w", err)
	}
	defer image.Close()
	if width < image.Width() {
		if err := image.Resize(float64(width)/float64(image.Width()), vips.KernelLanczos3); err != nil {
			return completion.Variant{}, fmt.Errorf("resize display variant: %w", err)
		}
	}

	params := vips.NewWebpExportParams()
	params.Quality = 82
	params.StripMetadata = true
	payload, metadata, err := image.ExportWebp(params)
	if err != nil {
		return completion.Variant{}, fmt.Errorf("encode display variant: %w", err)
	}
	objectKey := fmt.Sprintf("%sdisplay-%d.webp", command.DestinationPrefix, width)
	return processor.putVariant(ctx, command.DestinationBucket, objectKey, "image/webp", payload, metadata)
}

func (processor Processor) writeDownload(
	ctx context.Context,
	command messaging.PrepareImageCommandV1,
	source *vips.ImageRef,
	transparent bool,
) (completion.Variant, error) {
	image, err := source.Copy()
	if err != nil {
		return completion.Variant{}, fmt.Errorf("copy image for download variant: %w", err)
	}
	defer image.Close()

	var payload []byte
	var metadata *vips.ImageMetadata
	var contentType string
	var extension string
	if transparent {
		params := vips.NewPngExportParams()
		params.Compression = 9
		params.Filter = vips.PngFilterAll
		params.StripMetadata = true
		payload, metadata, err = image.ExportPng(params)
		contentType = "image/png"
		extension = "png"
	} else {
		params := vips.NewJpegExportParams()
		params.Quality = 85
		params.OptimizeCoding = true
		params.StripMetadata = true
		payload, metadata, err = image.ExportJpeg(params)
		contentType = "image/jpeg"
		extension = "jpg"
	}
	if err != nil {
		return completion.Variant{}, fmt.Errorf("encode download variant: %w", err)
	}
	objectKey := command.DestinationPrefix + "download." + extension
	return processor.putVariant(ctx, command.DestinationBucket, objectKey, contentType, payload, metadata)
}

func (processor Processor) putVariant(
	ctx context.Context,
	bucket string,
	objectKey string,
	contentType string,
	payload []byte,
	metadata *vips.ImageMetadata,
) (completion.Variant, error) {
	_, err := processor.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(bucket),
		Key:           aws.String(objectKey),
		Body:          bytes.NewReader(payload),
		ContentLength: aws.Int64(int64(len(payload))),
		ContentType:   aws.String(contentType),
	})
	if err != nil {
		return completion.Variant{}, fmt.Errorf("put variant %q: %w", objectKey, err)
	}
	return completion.Variant{
		Bucket:      bucket,
		ObjectKey:   objectKey,
		ContentType: contentType,
		ByteSize:    int64(len(payload)),
		PixelDimensions: &completion.PixelDimensions{
			Width:  metadata.Width,
			Height: metadata.Height,
		},
	}, nil
}

func validateCommand(command messaging.PrepareImageCommandV1) error {
	if err := worker.ValidateULID("command ID", command.CommandId); err != nil {
		return err
	}
	if err := worker.ValidateULID("asset ID", command.AssetId); err != nil {
		return err
	}
	if strings.TrimSpace(command.SourceBucket) == "" {
		return fmt.Errorf("source bucket is required")
	}
	if strings.TrimSpace(command.SourceObjectKey) == "" {
		return fmt.Errorf("source object key is required")
	}
	if strings.TrimSpace(command.SourceContentType) == "" {
		return fmt.Errorf("source content type is required")
	}
	if command.SourceByteSize < 0 {
		return fmt.Errorf("source byte size must be non-negative")
	}
	if strings.TrimSpace(command.SourceObjectEtag) == "" {
		return fmt.Errorf("source object ETag is required")
	}
	if strings.TrimSpace(command.DestinationBucket) == "" {
		return fmt.Errorf("destination bucket is required")
	}
	if command.DestinationPrefix == "" || !strings.HasSuffix(command.DestinationPrefix, "/") {
		return fmt.Errorf("destination prefix must end with a slash")
	}
	if strings.TrimSpace(command.ProcessingProfileName) == "" || command.ProcessingProfileVersion < 1 {
		return fmt.Errorf("processing profile name and positive version are required")
	}
	return nil
}

func isSupportedImageType(imageType vips.ImageType) bool {
	return slices.Contains(supportedImageTypes[:], imageType)
}

func isValidImage(image *vips.ImageRef) bool {
	return image.Width() > 0 && image.Height() > 0 && image.Pages() == 1
}

func validateRecord(record completion.Record, command messaging.PrepareImageCommandV1) error {
	if err := completion.ValidateOwnership(
		record,
		command.CommandId,
		command.AssetId,
		command.DestinationBucket,
		command.DestinationPrefix,
	); err != nil {
		return err
	}
	want := map[string]bool{
		"DISPLAY_SMALL":  false,
		"DISPLAY_MEDIUM": false,
		"DISPLAY_LARGE":  false,
		"DOWNLOAD":       false,
	}
	if len(record.Variants) != len(want) {
		return fmt.Errorf("image completion record must contain four variants")
	}
	for _, variant := range record.Variants {
		seen, ok := want[variant.Type]
		if !ok || seen {
			return fmt.Errorf("image completion record has invalid or duplicate variant type %q", variant.Type)
		}
		if variant.PixelDimensions == nil {
			return fmt.Errorf("image variant %q requires pixel dimensions", variant.Type)
		}
		want[variant.Type] = true
	}
	return nil
}
