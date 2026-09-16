package messaging

type AssetPreparationCompletedEventV1 struct {
	CommandId string           `json:"commandId" binding:"required"`
	AssetId   string           `json:"assetId" binding:"required"`
	Variants  []AssetVariantV1 `json:"variants" binding:"required"`
}
