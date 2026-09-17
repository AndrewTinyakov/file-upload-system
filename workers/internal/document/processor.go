package document

import (
	"context"
	"fmt"
	"strings"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/completion"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/objectstore"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const originalObjectName = "original"

type Client interface {
	HeadObject(context.Context, *s3.HeadObjectInput, ...func(*s3.Options)) (*s3.HeadObjectOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	CopyObject(context.Context, *s3.CopyObjectInput, ...func(*s3.Options)) (*s3.CopyObjectOutput, error)
	CreateMultipartUpload(context.Context, *s3.CreateMultipartUploadInput, ...func(*s3.Options)) (*s3.CreateMultipartUploadOutput, error)
	UploadPartCopy(context.Context, *s3.UploadPartCopyInput, ...func(*s3.Options)) (*s3.UploadPartCopyOutput, error)
	CompleteMultipartUpload(context.Context, *s3.CompleteMultipartUploadInput, ...func(*s3.Options)) (*s3.CompleteMultipartUploadOutput, error)
	AbortMultipartUpload(context.Context, *s3.AbortMultipartUploadInput, ...func(*s3.Options)) (*s3.AbortMultipartUploadOutput, error)
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
	command messaging.PrepareDocumentCommandV1,
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

	objectKey := command.DestinationPrefix + originalObjectName
	if err := objectstore.Copy(ctx, processor.client, source, objectstore.CopyDestination{
		Bucket:    command.DestinationBucket,
		ObjectKey: objectKey,
	}); err != nil {
		return completion.Record{}, err
	}

	result := completion.Record{
		CommandID: command.CommandId,
		AssetID:   command.AssetId,
		Variants: []completion.Variant{{
			Type:        "ORIGINAL",
			Bucket:      command.DestinationBucket,
			ObjectKey:   objectKey,
			ContentType: command.SourceContentType,
			ByteSize:    int64(command.SourceByteSize),
		}},
	}
	if err := processor.store.Save(ctx, command.DestinationBucket, command.DestinationPrefix, result); err != nil {
		return completion.Record{}, err
	}
	return result, nil
}

func validateCommand(command messaging.PrepareDocumentCommandV1) error {
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
	return nil
}

func validateRecord(record completion.Record, command messaging.PrepareDocumentCommandV1) error {
	if err := completion.ValidateOwnership(
		record,
		command.CommandId,
		command.AssetId,
		command.DestinationBucket,
		command.DestinationPrefix,
	); err != nil {
		return err
	}
	if len(record.Variants) != 1 || record.Variants[0].Type != "ORIGINAL" {
		return fmt.Errorf("document completion record must contain one ORIGINAL variant")
	}
	if record.Variants[0].PixelDimensions != nil {
		return fmt.Errorf("document ORIGINAL variant must not contain pixel dimensions")
	}
	return nil
}
