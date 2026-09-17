package document

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/completion"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/messagecodec"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type documentTestClient struct {
	completionPayload string
	headInput         *s3.HeadObjectInput
	copyInput         *s3.CopyObjectInput
	putInput          *s3.PutObjectInput
}

const (
	documentTestCommandID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
	documentTestAssetID   = "01ARZ3NDEKTSV4RRFFQ69G5FAW"
)

func (client *documentTestClient) HeadObject(
	_ context.Context,
	input *s3.HeadObjectInput,
	_ ...func(*s3.Options),
) (*s3.HeadObjectOutput, error) {
	client.headInput = input
	return &s3.HeadObjectOutput{ContentLength: aws.Int64(4), ETag: aws.String(`"etag-1"`)}, nil
}

func (client *documentTestClient) GetObject(
	_ context.Context,
	_ *s3.GetObjectInput,
	_ ...func(*s3.Options),
) (*s3.GetObjectOutput, error) {
	if client.completionPayload == "" {
		return nil, &types.NoSuchKey{}
	}
	return &s3.GetObjectOutput{Body: io.NopCloser(strings.NewReader(client.completionPayload))}, nil
}

func (client *documentTestClient) PutObject(
	_ context.Context,
	input *s3.PutObjectInput,
	_ ...func(*s3.Options),
) (*s3.PutObjectOutput, error) {
	client.putInput = input
	return &s3.PutObjectOutput{}, nil
}

func (client *documentTestClient) CopyObject(
	_ context.Context,
	input *s3.CopyObjectInput,
	_ ...func(*s3.Options),
) (*s3.CopyObjectOutput, error) {
	client.copyInput = input
	return &s3.CopyObjectOutput{}, nil
}

func (*documentTestClient) CreateMultipartUpload(
	context.Context,
	*s3.CreateMultipartUploadInput,
	...func(*s3.Options),
) (*s3.CreateMultipartUploadOutput, error) {
	return nil, nil
}

func (*documentTestClient) UploadPartCopy(
	context.Context,
	*s3.UploadPartCopyInput,
	...func(*s3.Options),
) (*s3.UploadPartCopyOutput, error) {
	return nil, nil
}

func (*documentTestClient) CompleteMultipartUpload(
	context.Context,
	*s3.CompleteMultipartUploadInput,
	...func(*s3.Options),
) (*s3.CompleteMultipartUploadOutput, error) {
	return nil, nil
}

func (*documentTestClient) AbortMultipartUpload(
	context.Context,
	*s3.AbortMultipartUploadInput,
	...func(*s3.Options),
) (*s3.AbortMultipartUploadOutput, error) {
	return nil, nil
}

func TestProcessorCopiesDocumentAndCommitsCompletionRecord(t *testing.T) {
	client := &documentTestClient{}
	command := documentCommand()

	record, err := NewProcessor(client).Process(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	if client.headInput == nil || client.copyInput == nil || client.putInput == nil {
		t.Fatalf("head, copy, put = %v, %v, %v", client.headInput, client.copyInput, client.putInput)
	}
	if got := aws.ToString(client.copyInput.Key); got != "assets/asset-1/original" {
		t.Fatalf("copy key = %q", got)
	}
	if len(record.Variants) != 1 || record.Variants[0].Type != "ORIGINAL" {
		t.Fatalf("record = %#v", record)
	}
	payload, err := io.ReadAll(client.putInput.Body)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := messagecodec.Decode[completion.Record](payload)
	if err != nil {
		t.Fatal(err)
	}
	if saved.CommandID != command.CommandId || saved.Variants[0].ObjectKey != "assets/asset-1/original" {
		t.Fatalf("saved record = %#v", saved)
	}
}

func TestProcessorReusesCompletionRecordWithoutReadingSource(t *testing.T) {
	client := &documentTestClient{completionPayload: `{"commandId":"01ARZ3NDEKTSV4RRFFQ69G5FAV","assetId":"01ARZ3NDEKTSV4RRFFQ69G5FAW","variants":[{"variantType":"ORIGINAL","bucket":"assets","objectKey":"assets/asset-1/original","contentType":"application/pdf","byteSize":4}]}`}

	record, err := NewProcessor(client).Process(context.Background(), documentCommand())
	if err != nil {
		t.Fatal(err)
	}
	if record.CommandID != documentTestCommandID {
		t.Fatalf("record = %#v", record)
	}
	if client.headInput != nil || client.copyInput != nil || client.putInput != nil {
		t.Fatal("existing completion record touched source or destination")
	}
}

func TestProcessorRejectsCompletionRecordForAnotherCommand(t *testing.T) {
	client := &documentTestClient{completionPayload: `{"commandId":"01ARZ3NDEKTSV4RRFFQ69G5FAX","assetId":"01ARZ3NDEKTSV4RRFFQ69G5FAW","variants":[{"variantType":"ORIGINAL","bucket":"assets","objectKey":"assets/asset-1/original","contentType":"application/pdf","byteSize":4}]}`}

	if _, err := NewProcessor(client).Process(context.Background(), documentCommand()); err == nil {
		t.Fatal("Process() error = nil, want completion ownership error")
	}
}

func documentCommand() messaging.PrepareDocumentCommandV1 {
	return messaging.PrepareDocumentCommandV1{
		CommandId:         documentTestCommandID,
		AssetId:           documentTestAssetID,
		SourceBucket:      "uploads",
		SourceObjectKey:   "source/file",
		SourceContentType: "application/pdf",
		SourceByteSize:    4,
		SourceObjectEtag:  "etag-1",
		DestinationBucket: "assets",
		DestinationPrefix: "assets/asset-1/",
	}
}
