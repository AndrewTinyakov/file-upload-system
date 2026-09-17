package objectstore

import (
	"context"
	"errors"
	"testing"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

type copyTestClient struct {
	copyInput     *s3.CopyObjectInput
	copyErr       error
	createInput   *s3.CreateMultipartUploadInput
	createOutput  *s3.CreateMultipartUploadOutput
	createErr     error
	partInputs    []*s3.UploadPartCopyInput
	partErrorAt   int
	partErr       error
	completeInput *s3.CompleteMultipartUploadInput
	completeErr   error
	abortInput    *s3.AbortMultipartUploadInput
	abortErr      error
}

func (client *copyTestClient) CopyObject(
	_ context.Context,
	input *s3.CopyObjectInput,
	_ ...func(*s3.Options),
) (*s3.CopyObjectOutput, error) {
	client.copyInput = input
	return &s3.CopyObjectOutput{}, client.copyErr
}

func (client *copyTestClient) CreateMultipartUpload(
	_ context.Context,
	input *s3.CreateMultipartUploadInput,
	_ ...func(*s3.Options),
) (*s3.CreateMultipartUploadOutput, error) {
	client.createInput = input
	return client.createOutput, client.createErr
}

func (client *copyTestClient) UploadPartCopy(
	_ context.Context,
	input *s3.UploadPartCopyInput,
	_ ...func(*s3.Options),
) (*s3.UploadPartCopyOutput, error) {
	client.partInputs = append(client.partInputs, input)
	if client.partErrorAt == len(client.partInputs) {
		return nil, client.partErr
	}
	return &s3.UploadPartCopyOutput{CopyPartResult: &types.CopyPartResult{
		ETag: aws.String("part-etag"),
	}}, nil
}

func (client *copyTestClient) CompleteMultipartUpload(
	_ context.Context,
	input *s3.CompleteMultipartUploadInput,
	_ ...func(*s3.Options),
) (*s3.CompleteMultipartUploadOutput, error) {
	client.completeInput = input
	return &s3.CompleteMultipartUploadOutput{}, client.completeErr
}

func (client *copyTestClient) AbortMultipartUpload(
	_ context.Context,
	input *s3.AbortMultipartUploadInput,
	_ ...func(*s3.Options),
) (*s3.AbortMultipartUploadOutput, error) {
	client.abortInput = input
	return &s3.AbortMultipartUploadOutput{}, client.abortErr
}

func TestCopyUsesConditionalSingleCopy(t *testing.T) {
	source := testSource()
	source.ObjectKey = "folder/a b.pdf"
	client := &copyTestClient{}

	err := Copy(context.Background(), client, source, CopyDestination{Bucket: "assets", ObjectKey: "asset/original"})
	if err != nil {
		t.Fatal(err)
	}
	if got := aws.ToString(client.copyInput.CopySource); got != "uploads%2Ffolder%2Fa%20b.pdf" {
		t.Fatalf("CopySource = %q", got)
	}
	if got := aws.ToString(client.copyInput.CopySourceIfMatch); got != `"etag-1"` {
		t.Fatalf("CopySourceIfMatch = %q", got)
	}
	if client.copyInput.MetadataDirective != types.MetadataDirectiveReplace {
		t.Fatalf("MetadataDirective = %q", client.copyInput.MetadataDirective)
	}
}

func TestCopyUsesMultipartCopyForLargeObject(t *testing.T) {
	source := testSource()
	source.ByteSize = singleCopyMaximum + 1
	client := &copyTestClient{createOutput: &s3.CreateMultipartUploadOutput{UploadId: aws.String("upload-1")}}

	err := Copy(context.Background(), client, source, CopyDestination{Bucket: "assets", ObjectKey: "asset/original"})
	if err != nil {
		t.Fatal(err)
	}
	if client.copyInput != nil {
		t.Fatal("large object used CopyObject")
	}
	if len(client.partInputs) != 81 {
		t.Fatalf("part count = %d, want 81", len(client.partInputs))
	}
	if got := aws.ToString(client.partInputs[0].CopySourceRange); got != "bytes=0-67108863" {
		t.Fatalf("first range = %q", got)
	}
	if got := aws.ToString(client.partInputs[len(client.partInputs)-1].CopySourceRange); got != "bytes=5368709120-5368709120" {
		t.Fatalf("last range = %q", got)
	}
	if client.completeInput == nil || len(client.completeInput.MultipartUpload.Parts) != 81 {
		t.Fatalf("complete input = %#v", client.completeInput)
	}
	if client.abortInput != nil {
		t.Fatal("successful multipart copy was aborted")
	}
}

func TestCopyAbortsFailedMultipartCopyAndClassifiesSourceChange(t *testing.T) {
	source := testSource()
	source.ByteSize = singleCopyMaximum + 1
	client := &copyTestClient{
		createOutput: &s3.CreateMultipartUploadOutput{UploadId: aws.String("upload-1")},
		partErrorAt:  2,
		partErr:      &smithy.GenericAPIError{Code: "PreconditionFailed", Message: "changed"},
	}

	err := Copy(context.Background(), client, source, CopyDestination{Bucket: "assets", ObjectKey: "asset/original"})
	if code, ok := worker.PermanentFailureCode(err); !ok || code != worker.FailureSourceObjectChanged {
		t.Fatalf("failure = %q, %t, %v", code, ok, err)
	}
	if client.abortInput == nil || aws.ToString(client.abortInput.UploadId) != "upload-1" {
		t.Fatalf("abort input = %#v", client.abortInput)
	}
}

func TestCopyJoinsAbortFailure(t *testing.T) {
	partErr := errors.New("copy failed")
	abortErr := errors.New("abort failed")
	source := testSource()
	source.ByteSize = singleCopyMaximum + 1
	client := &copyTestClient{
		createOutput: &s3.CreateMultipartUploadOutput{UploadId: aws.String("upload-1")},
		partErrorAt:  1,
		partErr:      partErr,
		abortErr:     abortErr,
	}

	err := Copy(context.Background(), client, source, CopyDestination{Bucket: "assets", ObjectKey: "asset/original"})
	if !errors.Is(err, partErr) || !errors.Is(err, abortErr) {
		t.Fatalf("Copy() error = %v", err)
	}
}

func TestCopyPartSizeStaysWithinPartLimit(t *testing.T) {
	const maximumS3Object = int64(5 * 1024 * 1024 * 1024 * 1024)
	partSize := copyPartSize(maximumS3Object)
	partCount := (maximumS3Object + partSize - 1) / partSize
	if partCount > maximumCopyParts {
		t.Fatalf("part count = %d, want at most %d", partCount, maximumCopyParts)
	}
}
