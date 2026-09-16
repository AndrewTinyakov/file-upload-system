package completion

import (
	"context"
	"io"
	"reflect"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const completionRecordJSON = `{"commandId":"command-1","assetId":"asset-1","variants":[{"variantType":"ORIGINAL","bucket":"assets","objectKey":"assets/asset-1/original.pdf","contentType":"application/pdf","byteSize":128}]}`

type fakeObjectClient struct {
	getInput  *s3.GetObjectInput
	getOutput *s3.GetObjectOutput
	getError  error
	putInput  *s3.PutObjectInput
	putError  error
}

func (client *fakeObjectClient) GetObject(
	_ context.Context,
	input *s3.GetObjectInput,
	_ ...func(*s3.Options),
) (*s3.GetObjectOutput, error) {
	client.getInput = input
	return client.getOutput, client.getError
}

func (client *fakeObjectClient) PutObject(
	_ context.Context,
	input *s3.PutObjectInput,
	_ ...func(*s3.Options),
) (*s3.PutObjectOutput, error) {
	client.putInput = input
	return &s3.PutObjectOutput{}, client.putError
}

func TestStoreSavesCompletionRecord(t *testing.T) {
	client := &fakeObjectClient{}
	store := NewStore(client)
	want := testRecord()

	if err := store.Save(context.Background(), "assets", "assets/asset-1/", want); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if got := *client.putInput.Bucket; got != "assets" {
		t.Fatalf("bucket = %q, want assets", got)
	}
	if got := *client.putInput.Key; got != "assets/asset-1/complete.json" {
		t.Fatalf("key = %q, want assets/asset-1/complete.json", got)
	}
	if got := *client.putInput.ContentType; got != "application/json" {
		t.Fatalf("content type = %q, want application/json", got)
	}

	payload, err := io.ReadAll(client.putInput.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(payload) != completionRecordJSON {
		t.Fatalf("saved body = %s, want %s", payload, completionRecordJSON)
	}
}

func TestStorePreservesDestinationPrefix(t *testing.T) {
	for _, prefix := range []string{"assets/id/", "/assets/id/", "assets/id//", "/", "//"} {
		t.Run(prefix, func(t *testing.T) {
			client := &fakeObjectClient{getError: &types.NoSuchKey{}}
			store := NewStore(client)
			if err := store.Save(context.Background(), "assets", prefix, testRecord()); err != nil {
				t.Fatal(err)
			}
			if _, err := store.Load(context.Background(), "assets", prefix); err != nil {
				t.Fatal(err)
			}
			want := prefix + "complete.json"
			if got := *client.putInput.Key; got != want {
				t.Errorf("saved key = %q, want %q", got, want)
			}
			if got := *client.getInput.Key; got != want {
				t.Errorf("loaded key = %q, want %q", got, want)
			}
		})
	}
}

func TestStoreLoadsCompletionRecord(t *testing.T) {
	want := testRecord()
	client := &fakeObjectClient{
		getOutput: &s3.GetObjectOutput{Body: io.NopCloser(strings.NewReader(completionRecordJSON))},
	}

	got, err := NewStore(client).Load(context.Background(), "assets", "assets/asset-1")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !reflect.DeepEqual(*got, want) {
		t.Fatalf("Load() = %#v, want %#v", *got, want)
	}
}

func TestStoreReturnsNilWhenCompletionRecordDoesNotExist(t *testing.T) {
	client := &fakeObjectClient{getError: &types.NoSuchKey{}}

	got, err := NewStore(client).Load(context.Background(), "assets", "assets/asset-1")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got != nil {
		t.Fatalf("Load() = %#v, want nil", got)
	}
}

func TestStoreRejectsIncompleteCompletionRecord(t *testing.T) {
	record := testRecord()
	record.Variants[0].ObjectKey = ""

	err := NewStore(&fakeObjectClient{}).Save(
		context.Background(),
		"assets",
		"assets/asset-1",
		record,
	)
	if err == nil {
		t.Fatal("Save() error = nil, want validation error")
	}
}

func TestStoreRejectsCompletionRecordWithoutVariantType(t *testing.T) {
	payload := strings.Replace(completionRecordJSON, `"ORIGINAL"`, `""`, 1)
	client := &fakeObjectClient{
		getOutput: &s3.GetObjectOutput{Body: io.NopCloser(strings.NewReader(payload))},
	}

	record, err := NewStore(client).Load(context.Background(), "assets", "assets/asset-1/")
	if err == nil || record != nil {
		t.Fatalf("Load() = %v, %v, want nil record and validation error", record, err)
	}
}

func TestStoreAllowsNewVariantTypes(t *testing.T) {
	payload := strings.Replace(completionRecordJSON, `"ORIGINAL"`, `"FUTURE_VARIANT"`, 1)
	client := &fakeObjectClient{
		getOutput: &s3.GetObjectOutput{Body: io.NopCloser(strings.NewReader(payload))},
	}

	record, err := NewStore(client).Load(context.Background(), "assets", "assets/asset-1/")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if record.Variants[0].Type != "FUTURE_VARIANT" {
		t.Fatalf("variant type = %q, want FUTURE_VARIANT", record.Variants[0].Type)
	}
}

func testRecord() Record {
	return Record{
		CommandID: "command-1",
		AssetID:   "asset-1",
		Variants: []Variant{
			{
				Type:        "ORIGINAL",
				Bucket:      "assets",
				ObjectKey:   "assets/asset-1/original.pdf",
				ContentType: "application/pdf",
				ByteSize:    128,
			},
		},
	}
}
