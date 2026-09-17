package document

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/config"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/objectstore"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func TestProcessorAgainstS3CompatibleStorage(t *testing.T) {
	endpoint := os.Getenv("S3_TEST_ENDPOINT")
	if endpoint == "" {
		t.Skip("set S3_TEST_ENDPOINT to an S3-compatible test service")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client, err := objectstore.NewS3(ctx, config.Storage{
		Endpoint:  endpoint,
		Region:    "us-east-1",
		AccessKey: "file_upload",
		SecretKey: "file_upload",
		PathStyle: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	unique := fmt.Sprintf("worker-integration/%d", time.Now().UnixNano())
	sourceKey := unique + "/source file.pdf"
	destinationPrefix := unique + "/asset/"
	payload := []byte("document integration payload")
	put, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String("uploads"),
		Key:           aws.String(sourceKey),
		Body:          strings.NewReader(string(payload)),
		ContentLength: aws.Int64(int64(len(payload))),
		ContentType:   aws.String("application/pdf"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if put.ETag == nil {
		t.Fatal("source upload returned no ETag")
	}
	defer client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
		Bucket: aws.String("uploads"), Key: aws.String(sourceKey),
	})
	defer client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
		Bucket: aws.String("assets"), Key: aws.String(destinationPrefix + "original"),
	})
	defer client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
		Bucket: aws.String("assets"), Key: aws.String(destinationPrefix + "complete.json"),
	})

	command := messaging.PrepareDocumentCommandV1{
		CommandId:         "01ARZ3NDEKTSV4RRFFQ69G5FAV",
		AssetId:           "01ARZ3NDEKTSV4RRFFQ69G5FAW",
		SourceBucket:      "uploads",
		SourceObjectKey:   sourceKey,
		SourceContentType: "application/pdf",
		SourceByteSize:    len(payload),
		SourceObjectEtag:  aws.ToString(put.ETag),
		DestinationBucket: "assets",
		DestinationPrefix: destinationPrefix,
	}
	record, err := NewProcessor(client).Process(ctx, command)
	if err != nil {
		t.Fatal(err)
	}
	if len(record.Variants) != 1 || record.Variants[0].ObjectKey != destinationPrefix+"original" {
		t.Fatalf("record = %#v", record)
	}

	stored, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String("assets"), Key: aws.String(destinationPrefix + "original"),
	})
	if err != nil {
		t.Fatal(err)
	}
	storedPayload, err := io.ReadAll(stored.Body)
	stored.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if string(storedPayload) != string(payload) {
		t.Fatalf("stored payload = %q", storedPayload)
	}

	if _, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String("uploads"), Key: aws.String(sourceKey),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := NewProcessor(client).Process(ctx, command); err != nil {
		t.Fatalf("idempotent retry after source deletion: %v", err)
	}
}
