package messaging

type AssetPreparationCompletedEventV1 struct {
	CommandId            string           `json:"commandId" binding:"required"`
	AssetId              string           `json:"assetId" binding:"required"`
	PreparationStartedAt string           `json:"preparationStartedAt" binding:"required"`
	WorkerStartedAt      string           `json:"workerStartedAt" binding:"required"`
	WorkerFinishedAt     string           `json:"workerFinishedAt" binding:"required"`
	Variants             []AssetVariantV1 `json:"variants" binding:"required"`
}
