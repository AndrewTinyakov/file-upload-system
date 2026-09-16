package messaging

type PrepareImageCommandV1 struct {
	CommandId                string `json:"commandId" binding:"required"`
	AssetId                  string `json:"assetId" binding:"required"`
	SourceBucket             string `json:"sourceBucket" binding:"required"`
	SourceObjectKey          string `json:"sourceObjectKey" binding:"required"`
	SourceContentType        string `json:"sourceContentType" binding:"required"`
	SourceByteSize           int    `json:"sourceByteSize" binding:"required"`
	SourceObjectEtag         string `json:"sourceObjectEtag" binding:"required"`
	DestinationBucket        string `json:"destinationBucket" binding:"required"`
	DestinationPrefix        string `json:"destinationPrefix" binding:"required"`
	ProcessingProfileName    string `json:"processingProfileName" binding:"required"`
	ProcessingProfileVersion int    `json:"processingProfileVersion" binding:"required"`
}
