package image

import (
	"context"
	"fmt"
	"sync"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/completion"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
	"github.com/davidbyttow/govips/v2/vips"
)

func (processor Processor) writeVariants(
	ctx context.Context,
	command messaging.PrepareImageCommandV1,
	profile Profile,
	image *vips.ImageRef,
) ([]completion.Variant, error) {
	jobs := make([]variantJob, 0, len(profile.Variants))
	displayJobs := make(map[int]struct{})
	transparent := image.HasAlpha()

	for _, spec := range profile.Variants {
		switch spec.Encoding {
		case DisplayWebP:
			width := min(image.Width(), spec.MaxWidth)
			if _, exists := displayJobs[width]; !exists {
				displayJobs[width] = struct{}{}
				jobs = append(jobs, variantJob{
					displayWidth: width,
					write: func(ctx context.Context) (completion.Variant, error) {
						return processor.writeDisplay(ctx, command, image, width)
					},
				})
			}
		case DownloadJpegOrPng:
			jobs = append(jobs, variantJob{
				download: true,
				write: func(ctx context.Context) (completion.Variant, error) {
					return processor.writeDownload(ctx, command, image, transparent)
				},
			})
		default:
			return nil, fmt.Errorf("unsupported image variant encoding %q", spec.Encoding)
		}
	}

	written, err := runVariantJobs(ctx, jobs, processor.variantConcurrency)
	if err != nil {
		return nil, err
	}
	displays := make(map[int]completion.Variant)
	var download completion.Variant
	for index, job := range jobs {
		if job.download {
			download = written[index]
		} else {
			displays[job.displayWidth] = written[index]
		}
	}

	variants := make([]completion.Variant, 0, len(profile.Variants))
	for _, spec := range profile.Variants {
		var variant completion.Variant
		switch spec.Encoding {
		case DisplayWebP:
			variant = displays[min(image.Width(), spec.MaxWidth)]
		case DownloadJpegOrPng:
			variant = download
		}
		variant.Type = spec.Type.Value().(string)
		variants = append(variants, variant)
	}
	return variants, nil
}

type variantJob struct {
	displayWidth int
	download     bool
	write        func(context.Context) (completion.Variant, error)
}

func runVariantJobs(
	ctx context.Context,
	jobs []variantJob,
	concurrency int,
) ([]completion.Variant, error) {
	if concurrency < 1 {
		return nil, fmt.Errorf("variant concurrency must be positive")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	outputs := make([]completion.Variant, len(jobs))
	semaphore := make(chan struct{}, min(concurrency, len(jobs)))
	errors := make(chan error, len(jobs))
	var workers sync.WaitGroup
	for index, job := range jobs {
		workers.Go(func() {
			select {
			case semaphore <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-semaphore }()
			output, err := job.write(ctx)
			if err != nil {
				errors <- err
				cancel()
				return
			}
			outputs[index] = output
		})
	}
	workers.Wait()
	select {
	case err := <-errors:
		return nil, err
	default:
		return outputs, nil
	}
}
