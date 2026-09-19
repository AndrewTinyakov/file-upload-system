package messaging

type AbortMultipartUploadCommandV1 struct {
	CommandId       string `json:"commandId" binding:"required"`
	UploadSessionId string `json:"uploadSessionId" binding:"required"`
	Bucket          string `json:"bucket" binding:"required"`
	ObjectKey       string `json:"objectKey" binding:"required"`
	UploadId        string `json:"uploadId" binding:"required"`
}
