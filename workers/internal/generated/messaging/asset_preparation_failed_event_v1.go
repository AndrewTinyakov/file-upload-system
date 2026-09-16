package messaging

type AssetPreparationFailedEventV1 struct {
	CommandId   string `json:"commandId" binding:"required"`
	AssetId     string `json:"assetId" binding:"required"`
	FailureCode string `json:"failureCode" binding:"required"`
}
