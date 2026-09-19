package messaging

type DeleteAssetPrefixCommandV1 struct {
	CommandId string `json:"commandId" binding:"required"`
	AssetId   string `json:"assetId" binding:"required"`
	Bucket    string `json:"bucket" binding:"required"`
	Prefix    string `json:"prefix" binding:"required"`
}
