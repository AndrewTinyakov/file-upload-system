package config

const (
	defaultRabbitMQURL = "amqp://file_upload:file_upload@localhost:5672/file_upload"
	defaultS3Endpoint  = "http://localhost:9000"
	defaultS3Region    = "us-east-1"
)

type Worker struct {
	RabbitMQ    RabbitMQ
	Concurrency int
	Storage     Storage
}

type RabbitMQ struct {
	URL           string
	Prefetch      int
	DeliveryLimit int
}

type Storage struct {
	Endpoint  string
	Region    string
	AccessKey string
	SecretKey string
	PathStyle bool
}

func loadWorker() (Worker, error) {
	concurrency, err := envIntAtLeast("WORKER_CONCURRENCY", 4, 1)
	if err != nil {
		return Worker{}, err
	}

	prefetch, err := envIntAtLeast("RABBITMQ_PREFETCH", concurrency, 1)
	if err != nil {
		return Worker{}, err
	}

	deliveryLimit, err := envIntAtLeast("RABBITMQ_DELIVERY_LIMIT", 5, 1)
	if err != nil {
		return Worker{}, err
	}

	pathStyle, err := envBool("S3_PATH_STYLE", true)
	if err != nil {
		return Worker{}, err
	}

	return Worker{
		RabbitMQ: RabbitMQ{
			URL:           envString("RABBITMQ_URL", defaultRabbitMQURL),
			Prefetch:      prefetch,
			DeliveryLimit: deliveryLimit,
		},
		Concurrency: concurrency,
		Storage: Storage{
			Endpoint:  envString("S3_ENDPOINT", defaultS3Endpoint),
			Region:    envString("S3_REGION", defaultS3Region),
			AccessKey: envString("S3_ACCESS_KEY", "file_upload"),
			SecretKey: envString("S3_SECRET_KEY", "file_upload"),
			PathStyle: pathStyle,
		},
	}, nil
}
