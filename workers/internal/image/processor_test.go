package image

import (
	"bytes"
	"context"
	"fmt"
	stdimage "image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"golang.org/x/image/webp"
)

type storedImageObject struct {
	contentType string
	payload     []byte
}

type imageTestClient struct {
	source     []byte
	completion string
	headCalls  int
	getCalls   int
	objects    map[string]storedImageObject
}

const (
	imageTestCommandID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
	imageTestAssetID   = "01ARZ3NDEKTSV4RRFFQ69G5FAW"
)

func (client *imageTestClient) HeadObject(
	_ context.Context,
	_ *s3.HeadObjectInput,
	_ ...func(*s3.Options),
) (*s3.HeadObjectOutput, error) {
	client.headCalls++
	return &s3.HeadObjectOutput{
		ContentLength: aws.Int64(int64(len(client.source))),
		ETag:          aws.String(`"etag-1"`),
	}, nil
}

func (client *imageTestClient) GetObject(
	_ context.Context,
	input *s3.GetObjectInput,
	_ ...func(*s3.Options),
) (*s3.GetObjectOutput, error) {
	client.getCalls++
	if strings.HasSuffix(aws.ToString(input.Key), "complete.json") {
		if client.completion == "" {
			return nil, &types.NoSuchKey{}
		}
		return &s3.GetObjectOutput{Body: io.NopCloser(strings.NewReader(client.completion))}, nil
	}
	return &s3.GetObjectOutput{Body: io.NopCloser(bytes.NewReader(client.source))}, nil
}

func (client *imageTestClient) PutObject(
	_ context.Context,
	input *s3.PutObjectInput,
	_ ...func(*s3.Options),
) (*s3.PutObjectOutput, error) {
	payload, err := io.ReadAll(input.Body)
	if err != nil {
		return nil, err
	}
	if client.objects == nil {
		client.objects = make(map[string]storedImageObject)
	}
	client.objects[aws.ToString(input.Key)] = storedImageObject{
		contentType: aws.ToString(input.ContentType),
		payload:     payload,
	}
	return &s3.PutObjectOutput{}, nil
}

func TestMain(m *testing.M) {
	shutdown, err := StartEngine(EngineConfig{
		Concurrency: 1, MaxCacheFiles: 0, MaxCacheMemory: 64 * 1024 * 1024, MaxCacheSize: 50,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	code := m.Run()
	shutdown()
	os.Exit(code)
}

func TestProcessorProducesOpaqueImageVariantsWithoutUpscaling(t *testing.T) {
	source := encodeJPEG(t, 320, 200)
	client := &imageTestClient{source: source}
	command := imageCommand(source)

	record, err := NewProcessor(client).Process(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	if len(record.Variants) != 4 {
		t.Fatalf("variant count = %d", len(record.Variants))
	}
	for index := 0; index < 3; index++ {
		variant := record.Variants[index]
		if variant.ObjectKey != "assets/asset-1/display-320.webp" {
			t.Fatalf("display key = %q", variant.ObjectKey)
		}
		if variant.PixelDimensions.Width != 320 || variant.PixelDimensions.Height != 200 {
			t.Fatalf("display dimensions = %#v", variant.PixelDimensions)
		}
	}
	download := record.Variants[3]
	if download.ObjectKey != "assets/asset-1/download.jpg" || download.ContentType != "image/jpeg" {
		t.Fatalf("download = %#v", download)
	}
	if len(client.objects) != 3 {
		t.Fatalf("stored object count = %d, want display, download, and completion", len(client.objects))
	}
	display, err := webp.Decode(bytes.NewReader(client.objects["assets/asset-1/display-320.webp"].payload))
	if err != nil {
		t.Fatal(err)
	}
	if display.Bounds().Dx() != 320 || display.Bounds().Dy() != 200 {
		t.Fatalf("stored display bounds = %v", display.Bounds())
	}
	if _, err := jpeg.Decode(bytes.NewReader(client.objects["assets/asset-1/download.jpg"].payload)); err != nil {
		t.Fatal(err)
	}
}

func TestProcessorKeepsTransparencyInDownloadVariant(t *testing.T) {
	source := encodeTransparentPNG(t, 100, 80)
	client := &imageTestClient{source: source}

	record, err := NewProcessor(client).Process(context.Background(), imageCommand(source))
	if err != nil {
		t.Fatal(err)
	}
	download := record.Variants[3]
	if download.ObjectKey != "assets/asset-1/download.png" || download.ContentType != "image/png" {
		t.Fatalf("download = %#v", download)
	}
	decoded, err := png.Decode(bytes.NewReader(client.objects[download.ObjectKey].payload))
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, alpha := decoded.At(0, 0).RGBA()
	if alpha == 0xffff {
		t.Fatal("download variant lost transparency")
	}
}

func TestProcessorResizesEachDistinctDisplayWidth(t *testing.T) {
	source := encodeJPEG(t, 1600, 900)
	client := &imageTestClient{source: source}

	record, err := NewProcessor(client).Process(context.Background(), imageCommand(source))
	if err != nil {
		t.Fatal(err)
	}
	wantWidths := []int{480, 1280, 1600}
	for index, want := range wantWidths {
		variant := record.Variants[index]
		if variant.PixelDimensions.Width != want {
			t.Fatalf("variant %d width = %d, want %d", index, variant.PixelDimensions.Width, want)
		}
	}
	if len(client.objects) != 5 {
		t.Fatalf("stored object count = %d, want three displays, download, and completion", len(client.objects))
	}
}

func TestProcessorRejectsUnsupportedImageFormat(t *testing.T) {
	source := []byte("GIF89a123456")
	client := &imageTestClient{source: source}

	_, err := NewProcessor(client).Process(context.Background(), imageCommand(source))
	if code, ok := worker.PermanentFailureCode(err); !ok || code != worker.FailureUnsupportedImageFormat {
		t.Fatalf("failure = %q, %t, %v", code, ok, err)
	}
}

func TestProcessorRejectsInvalidImage(t *testing.T) {
	source := append([]byte{0xff, 0xd8, 0xff}, bytes.Repeat([]byte{0}, 20)...)
	client := &imageTestClient{source: source}

	_, err := NewProcessor(client).Process(context.Background(), imageCommand(source))
	if code, ok := worker.PermanentFailureCode(err); !ok || code != worker.FailureInvalidImage {
		t.Fatalf("failure = %q, %t, %v", code, ok, err)
	}
}

func TestProcessorReusesCompletionRecordWithoutReadingSource(t *testing.T) {
	client := &imageTestClient{completion: `{"commandId":"01ARZ3NDEKTSV4RRFFQ69G5FAV","assetId":"01ARZ3NDEKTSV4RRFFQ69G5FAW","variants":[{"variantType":"DISPLAY_SMALL","bucket":"assets","objectKey":"assets/asset-1/display-320.webp","contentType":"image/webp","byteSize":10,"pixelDimensions":{"width":320,"height":200}},{"variantType":"DISPLAY_MEDIUM","bucket":"assets","objectKey":"assets/asset-1/display-320.webp","contentType":"image/webp","byteSize":10,"pixelDimensions":{"width":320,"height":200}},{"variantType":"DISPLAY_LARGE","bucket":"assets","objectKey":"assets/asset-1/display-320.webp","contentType":"image/webp","byteSize":10,"pixelDimensions":{"width":320,"height":200}},{"variantType":"DOWNLOAD","bucket":"assets","objectKey":"assets/asset-1/download.jpg","contentType":"image/jpeg","byteSize":11,"pixelDimensions":{"width":320,"height":200}}]}`}
	command := imageCommand(nil)
	command.SourceByteSize = 99

	record, err := NewProcessor(client).Process(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	if len(record.Variants) != 4 {
		t.Fatalf("record = %#v", record)
	}
	if client.headCalls != 0 || client.getCalls != 1 || len(client.objects) != 0 {
		t.Fatalf("head calls, get calls, objects = %d, %d, %d", client.headCalls, client.getCalls, len(client.objects))
	}
}

func imageCommand(source []byte) messaging.PrepareImageCommandV1 {
	return messaging.PrepareImageCommandV1{
		CommandId:                imageTestCommandID,
		AssetId:                  imageTestAssetID,
		SourceBucket:             "uploads",
		SourceObjectKey:          "source/image",
		SourceContentType:        "image/jpeg",
		SourceByteSize:           len(source),
		SourceObjectEtag:         "etag-1",
		DestinationBucket:        "assets",
		DestinationPrefix:        "assets/asset-1/",
		ProcessingProfileName:    DefaultProfileName,
		ProcessingProfileVersion: DefaultProfileVersion,
	}
}

func encodeJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	image := stdimage.NewRGBA(stdimage.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			image.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 120, A: 255})
		}
	}
	var output bytes.Buffer
	if err := jpeg.Encode(&output, image, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func encodeTransparentPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	image := stdimage.NewNRGBA(stdimage.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			image.SetNRGBA(x, y, color.NRGBA{R: 30, G: 80, B: 140, A: uint8((x + y) % 255)})
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, image); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
