package objectstore

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

type sourceTestClient struct {
	headInput *s3.HeadObjectInput
	head      *s3.HeadObjectOutput
	headErr   error
	getInput  *s3.GetObjectInput
	get       *s3.GetObjectOutput
	getErr    error
}

func (client *sourceTestClient) HeadObject(
	_ context.Context,
	input *s3.HeadObjectInput,
	_ ...func(*s3.Options),
) (*s3.HeadObjectOutput, error) {
	client.headInput = input
	return client.head, client.headErr
}

func (client *sourceTestClient) GetObject(
	_ context.Context,
	input *s3.GetObjectInput,
	_ ...func(*s3.Options),
) (*s3.GetObjectOutput, error) {
	client.getInput = input
	return client.get, client.getErr
}

func TestVerifySourceMatchesSizeAndETag(t *testing.T) {
	client := &sourceTestClient{head: &s3.HeadObjectOutput{
		ContentLength: aws.Int64(4),
		ETag:          aws.String(`"etag-1"`),
	}}

	if err := VerifySource(context.Background(), client, testSource()); err != nil {
		t.Fatal(err)
	}
	if got := aws.ToString(client.headInput.IfMatch); got != `"etag-1"` {
		t.Fatalf("IfMatch = %q", got)
	}
}

func TestVerifySourceClassifiesChangedObject(t *testing.T) {
	client := &sourceTestClient{head: &s3.HeadObjectOutput{
		ContentLength: aws.Int64(5),
		ETag:          aws.String(`"etag-1"`),
	}}

	err := VerifySource(context.Background(), client, testSource())
	if code, ok := worker.PermanentFailureCode(err); !ok || code != worker.FailureSourceObjectChanged {
		t.Fatalf("failure = %q, %t, %v", code, ok, err)
	}
}

func TestVerifySourceClassifiesMissingObject(t *testing.T) {
	client := &sourceTestClient{headErr: &smithy.GenericAPIError{Code: "NotFound", Message: "missing"}}

	err := VerifySource(context.Background(), client, testSource())
	if code, ok := worker.PermanentFailureCode(err); !ok || code != worker.FailureSourceObjectNotFound {
		t.Fatalf("failure = %q, %t, %v", code, ok, err)
	}
}

func TestVerifySourceLeavesTemporaryErrorRecoverable(t *testing.T) {
	temporary := errors.New("connection reset")
	client := &sourceTestClient{headErr: temporary}

	err := VerifySource(context.Background(), client, testSource())
	if !errors.Is(err, temporary) {
		t.Fatalf("VerifySource() error = %v", err)
	}
	if _, permanent := worker.PermanentFailureCode(err); permanent {
		t.Fatal("temporary error was classified as permanent")
	}
}

func TestReadSourceUsesConditionalGetAndChecksSize(t *testing.T) {
	client := &sourceTestClient{get: &s3.GetObjectOutput{
		Body: io.NopCloser(strings.NewReader("data")),
	}}

	payload, err := ReadSource(context.Background(), client, testSource())
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != "data" {
		t.Fatalf("payload = %q", payload)
	}
	if got := aws.ToString(client.getInput.IfMatch); got != `"etag-1"` {
		t.Fatalf("IfMatch = %q", got)
	}
}

func testSource() Source {
	return Source{
		Bucket: "uploads", ObjectKey: "source/file", ContentType: "application/octet-stream",
		ByteSize: 4, ObjectETag: "etag-1",
	}
}
