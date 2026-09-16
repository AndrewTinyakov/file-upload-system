package completion

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/messagecodec"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

const objectName = "complete.json"

type objectClient interface {
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

type Store struct {
	client objectClient
}

func NewStore(client objectClient) Store {
	return Store{client: client}
}

func (store Store) Load(
	ctx context.Context,
	bucket string,
	prefix string,
) (*Record, error) {
	key, err := objectKey(bucket, prefix)
	if err != nil {
		return nil, err
	}

	output, err := store.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if isNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("get completion record: %w", err)
	}
	defer output.Body.Close()

	payload, err := io.ReadAll(output.Body)
	if err != nil {
		return nil, fmt.Errorf("read completion record: %w", err)
	}

	record, err := messagecodec.Decode[Record](payload)
	if err != nil {
		return nil, fmt.Errorf("decode completion record: %w", err)
	}
	if err := validate(record); err != nil {
		return nil, fmt.Errorf("validate completion record: %w", err)
	}
	return &record, nil
}

func (store Store) Save(
	ctx context.Context,
	bucket string,
	prefix string,
	record Record,
) error {
	key, err := objectKey(bucket, prefix)
	if err != nil {
		return err
	}
	if err := validate(record); err != nil {
		return fmt.Errorf("validate completion record: %w", err)
	}

	payload, err := messagecodec.Encode(record)
	if err != nil {
		return fmt.Errorf("encode completion record: %w", err)
	}

	_, err = store.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(payload),
		ContentType: aws.String("application/json"),
	})
	if err != nil {
		return fmt.Errorf("put completion record: %w", err)
	}
	return nil
}

func objectKey(bucket string, prefix string) (string, error) {
	if strings.TrimSpace(bucket) == "" {
		return "", fmt.Errorf("bucket is required")
	}
	if prefix == "" {
		return "", fmt.Errorf("prefix is required")
	}
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	return prefix + objectName, nil
}

func validate(record Record) error {
	if record.CommandID == "" {
		return fmt.Errorf("command ID is required")
	}
	if record.AssetID == "" {
		return fmt.Errorf("asset ID is required")
	}
	if len(record.Variants) == 0 {
		return fmt.Errorf("at least one variant is required")
	}

	for index, variant := range record.Variants {
		if variant.Type == "" {
			return fmt.Errorf("variant %d type is required", index)
		}
		if variant.Bucket == "" {
			return fmt.Errorf("variant %d bucket is required", index)
		}
		if variant.ObjectKey == "" {
			return fmt.Errorf("variant %d object key is required", index)
		}
		if variant.ContentType == "" {
			return fmt.Errorf("variant %d content type is required", index)
		}
		if variant.ByteSize < 0 {
			return fmt.Errorf("variant %d byte size must be non-negative", index)
		}
		if variant.PixelDimensions != nil &&
			(variant.PixelDimensions.Width < 1 || variant.PixelDimensions.Height < 1) {
			return fmt.Errorf("variant %d pixel dimensions must be positive", index)
		}
	}
	return nil
}

func isNotFound(err error) bool {
	if _, ok := errors.AsType[*types.NoSuchKey](err); ok {
		return true
	}

	var apiError smithy.APIError
	return errors.As(err, &apiError) &&
		(apiError.ErrorCode() == "NoSuchKey" || apiError.ErrorCode() == "NotFound")
}
