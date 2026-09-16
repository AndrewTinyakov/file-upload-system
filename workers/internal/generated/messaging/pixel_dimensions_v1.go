package messaging

type PixelDimensionsV1 struct {
	Width  int `json:"width" binding:"required"`
	Height int `json:"height" binding:"required"`
}
