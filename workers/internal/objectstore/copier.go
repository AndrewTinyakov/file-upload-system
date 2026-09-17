package objectstore

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const (
	singleCopyMaximum     = int64(5 * 1024 * 1024 * 1024)
	minimumCopyPart       = int64(64 * 1024 * 1024)
	maximumCopyParts      = int64(10_000)
	multipartAbortTimeout = 30 * time.Second
)

type CopyDestination struct {
	Bucket    string
	ObjectKey string
}

type copyClient interface {
	CopyObject(context.Context, *s3.CopyObjectInput, ...func(*s3.Options)) (*s3.CopyObjectOutput, error)
	CreateMultipartUpload(context.Context, *s3.CreateMultipartUploadInput, ...func(*s3.Options)) (*s3.CreateMultipartUploadOutput, error)
	UploadPartCopy(context.Context, *s3.UploadPartCopyInput, ...func(*s3.Options)) (*s3.UploadPartCopyOutput, error)
	CompleteMultipartUpload(context.Context, *s3.CompleteMultipartUploadInput, ...func(*s3.Options)) (*s3.CompleteMultipartUploadOutput, error)
	AbortMultipartUpload(context.Context, *s3.AbortMultipartUploadInput, ...func(*s3.Options)) (*s3.AbortMultipartUploadOutput, error)
}

func Copy(ctx context.Context, client copyClient, source Source, destination CopyDestination) error {
	if destination.Bucket == "" {
		return fmt.Errorf("destination bucket is required")
	}
	if destination.ObjectKey == "" {
		return fmt.Errorf("destination object key is required")
	}
	if source.ByteSize <= singleCopyMaximum {
		return copySingle(ctx, client, source, destination)
	}
	return copyMultipart(ctx, client, source, destination)
}

func copySingle(ctx context.Context, client copyClient, source Source, destination CopyDestination) error {
	_, err := client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:            aws.String(destination.Bucket),
		Key:               aws.String(destination.ObjectKey),
		CopySource:        aws.String(copySource(source)),
		CopySourceIfMatch: aws.String(ifMatchETag(source.ObjectETag)),
		ContentType:       aws.String(source.ContentType),
		MetadataDirective: types.MetadataDirectiveReplace,
	})
	if err != nil {
		return classifySourceError("copy source object", err)
	}
	return nil
}

func copyMultipart(ctx context.Context, client copyClient, source Source, destination CopyDestination) (resultErr error) {
	created, err := client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket:      aws.String(destination.Bucket),
		Key:         aws.String(destination.ObjectKey),
		ContentType: aws.String(source.ContentType),
	})
	if err != nil {
		return fmt.Errorf("start multipart copy: %w", err)
	}
	if created.UploadId == nil || *created.UploadId == "" {
		return fmt.Errorf("start multipart copy: storage returned an empty upload ID")
	}

	uploadID := *created.UploadId
	defer func() {
		if resultErr == nil {
			return
		}
		abortCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), multipartAbortTimeout)
		defer cancel()
		_, abortErr := client.AbortMultipartUpload(abortCtx, &s3.AbortMultipartUploadInput{
			Bucket:   aws.String(destination.Bucket),
			Key:      aws.String(destination.ObjectKey),
			UploadId: aws.String(uploadID),
		})
		if abortErr != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("abort multipart copy: %w", abortErr))
		}
	}()

	partSize := copyPartSize(source.ByteSize)
	partCount := (source.ByteSize + partSize - 1) / partSize
	parts := make([]types.CompletedPart, 0, partCount)
	for index := range partCount {
		start := index * partSize
		end := min(start+partSize, source.ByteSize) - 1
		partNumber := int32(index + 1)
		output, err := client.UploadPartCopy(ctx, &s3.UploadPartCopyInput{
			Bucket:            aws.String(destination.Bucket),
			Key:               aws.String(destination.ObjectKey),
			UploadId:          aws.String(uploadID),
			PartNumber:        aws.Int32(partNumber),
			CopySource:        aws.String(copySource(source)),
			CopySourceIfMatch: aws.String(ifMatchETag(source.ObjectETag)),
			CopySourceRange:   aws.String(fmt.Sprintf("bytes=%d-%d", start, end)),
		})
		if err != nil {
			return classifySourceError(fmt.Sprintf("copy source part %d", partNumber), err)
		}
		if output.CopyPartResult == nil || output.CopyPartResult.ETag == nil {
			return fmt.Errorf("copy source part %d: storage returned an empty ETag", partNumber)
		}
		parts = append(parts, types.CompletedPart{
			ETag:       output.CopyPartResult.ETag,
			PartNumber: aws.Int32(partNumber),
		})
	}

	_, err = client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:   aws.String(destination.Bucket),
		Key:      aws.String(destination.ObjectKey),
		UploadId: aws.String(uploadID),
		MultipartUpload: &types.CompletedMultipartUpload{
			Parts: parts,
		},
	})
	if err != nil {
		return fmt.Errorf("complete multipart copy: %w", err)
	}
	return nil
}

func copyPartSize(byteSize int64) int64 {
	partSize := minimumCopyPart
	if required := (byteSize + maximumCopyParts - 1) / maximumCopyParts; required > partSize {
		partSize = required
	}
	return partSize
}

func copySource(source Source) string {
	return url.PathEscape(source.Bucket + "/" + source.ObjectKey)
}
