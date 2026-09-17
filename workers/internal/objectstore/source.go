package objectstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

type Source struct {
	Bucket      string
	ObjectKey   string
	ContentType string
	ByteSize    int64
	ObjectETag  string
}

type sourceClient interface {
	HeadObject(context.Context, *s3.HeadObjectInput, ...func(*s3.Options)) (*s3.HeadObjectOutput, error)
}

type sourceReader interface {
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
}

func VerifySource(ctx context.Context, client sourceClient, source Source) error {
	if err := validateSource(source); err != nil {
		return err
	}

	output, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket:  aws.String(source.Bucket),
		Key:     aws.String(source.ObjectKey),
		IfMatch: aws.String(ifMatchETag(source.ObjectETag)),
	})
	if err != nil {
		return classifySourceError("inspect source object", err)
	}

	if output.ContentLength == nil || *output.ContentLength != source.ByteSize {
		return worker.Permanent(
			worker.FailureSourceObjectChanged,
			fmt.Errorf("source byte size is %d, expected %d", aws.ToInt64(output.ContentLength), source.ByteSize),
		)
	}
	if output.ETag == nil || normalizeETag(*output.ETag) != normalizeETag(source.ObjectETag) {
		return worker.Permanent(
			worker.FailureSourceObjectChanged,
			fmt.Errorf("source ETag does not match command"),
		)
	}

	return nil
}

func ReadSource(ctx context.Context, client sourceReader, source Source) ([]byte, error) {
	if err := validateSource(source); err != nil {
		return nil, err
	}

	output, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket:  aws.String(source.Bucket),
		Key:     aws.String(source.ObjectKey),
		IfMatch: aws.String(ifMatchETag(source.ObjectETag)),
	})
	if err != nil {
		return nil, classifySourceError("read source object", err)
	}
	defer output.Body.Close()

	reader := io.Reader(output.Body)
	if source.ByteSize < int64(^uint64(0)>>1) {
		reader = io.LimitReader(output.Body, source.ByteSize+1)
	}
	payload, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read source object body: %w", err)
	}
	if int64(len(payload)) != source.ByteSize {
		return nil, worker.Permanent(
			worker.FailureSourceObjectChanged,
			fmt.Errorf("source body byte size is %d, expected %d", len(payload), source.ByteSize),
		)
	}
	return payload, nil
}

func validateSource(source Source) error {
	if strings.TrimSpace(source.Bucket) == "" {
		return fmt.Errorf("source bucket is required")
	}
	if strings.TrimSpace(source.ObjectKey) == "" {
		return fmt.Errorf("source object key is required")
	}
	if strings.TrimSpace(source.ContentType) == "" {
		return fmt.Errorf("source content type is required")
	}
	if source.ByteSize < 0 {
		return fmt.Errorf("source byte size must be non-negative")
	}
	if strings.TrimSpace(source.ObjectETag) == "" {
		return fmt.Errorf("source object ETag is required")
	}
	return nil
}

func classifySourceError(operation string, err error) error {
	if _, ok := errors.AsType[*types.NotFound](err); isAPIError(err, "NoSuchKey", "NotFound") || ok {
		return worker.Permanent(worker.FailureSourceObjectNotFound, fmt.Errorf("%s: %w", operation, err))
	}
	if isAPIError(err, "PreconditionFailed") {
		return worker.Permanent(worker.FailureSourceObjectChanged, fmt.Errorf("%s: %w", operation, err))
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func isAPIError(err error, codes ...string) bool {
	var apiError smithy.APIError
	if !errors.As(err, &apiError) {
		return false
	}
	for _, code := range codes {
		if apiError.ErrorCode() == code {
			return true
		}
	}
	return false
}

func ifMatchETag(etag string) string {
	etag = strings.TrimSpace(etag)
	if strings.HasPrefix(etag, "\"") && strings.HasSuffix(etag, "\"") {
		return etag
	}
	return "\"" + strings.Trim(etag, "\"") + "\""
}

func normalizeETag(etag string) string {
	return strings.Trim(strings.TrimSpace(etag), "\"")
}
