package objectstore

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type sourceBenchmarkClient struct {
	payload []byte
}

func (client *sourceBenchmarkClient) GetObject(
	_ context.Context,
	_ *s3.GetObjectInput,
	_ ...func(*s3.Options),
) (*s3.GetObjectOutput, error) {
	return &s3.GetObjectOutput{
		Body:          io.NopCloser(bytes.NewReader(client.payload)),
		ContentLength: aws.Int64(int64(len(client.payload))),
		ETag:          aws.String(`"benchmark-etag"`),
	}, nil
}

func BenchmarkReadSource(b *testing.B) {
	for _, fixture := range []struct {
		name string
		size int
	}{
		{name: "1MiB", size: 1024 * 1024},
		{name: "16MiB", size: 16 * 1024 * 1024},
	} {
		b.Run(fixture.name, func(b *testing.B) {
			client := &sourceBenchmarkClient{payload: bytes.Repeat([]byte("x"), fixture.size)}
			source := Source{
				Bucket: "uploads", ObjectKey: "source/image", ContentType: "image/jpeg",
				ByteSize: int64(fixture.size), ObjectETag: "benchmark-etag",
			}
			ctx := context.Background()
			b.SetBytes(int64(fixture.size))
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				payload, err := ReadSource(ctx, client, source)
				if err != nil {
					b.Fatal(err)
				}
				if len(payload) != fixture.size || payload[0] != 'x' || payload[len(payload)-1] != 'x' {
					b.Fatal("source payload did not match fixture")
				}
			}
		})
	}
}
