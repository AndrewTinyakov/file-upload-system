package config

const mebibyte = 1024 * 1024

type Image struct {
	Worker
	Vips Vips
}

type Vips struct {
	Concurrency    int
	MaxCacheFiles  int
	MaxCacheMemory int
	MaxCacheSize   int
}

func LoadImage() (Image, error) {
	worker, err := loadWorker()
	if err != nil {
		return Image{}, err
	}

	concurrency, err := envIntAtLeast("VIPS_CONCURRENCY", 1, 1)
	if err != nil {
		return Image{}, err
	}
	maxCacheFiles, err := envIntAtLeast("VIPS_MAX_CACHE_FILES", 0, 0)
	if err != nil {
		return Image{}, err
	}
	maxCacheMemoryMiB, err := envIntAtLeast("VIPS_MAX_CACHE_MEMORY_MIB", 256, 0)
	if err != nil {
		return Image{}, err
	}
	maxCacheSize, err := envIntAtLeast("VIPS_MAX_CACHE_SIZE", 100, 0)
	if err != nil {
		return Image{}, err
	}

	return Image{
		Worker: worker,
		Vips: Vips{
			Concurrency:    concurrency,
			MaxCacheFiles:  maxCacheFiles,
			MaxCacheMemory: maxCacheMemoryMiB * mebibyte,
			MaxCacheSize:   maxCacheSize,
		},
	}, nil
}
