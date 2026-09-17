package worker

import (
	"errors"
	"fmt"
)

const (
	FailureSourceObjectNotFound   = "SOURCE_OBJECT_NOT_FOUND"
	FailureSourceObjectChanged    = "SOURCE_OBJECT_CHANGED"
	FailureUnsupportedImageFormat = "UNSUPPORTED_IMAGE_FORMAT"
	FailureInvalidImage           = "INVALID_IMAGE"
	FailureUnknownProfile         = "UNKNOWN_PROCESSING_PROFILE"
)

type PermanentError struct {
	Code string
	Err  error
}

func (err *PermanentError) Error() string {
	return fmt.Sprintf("%s: %v", err.Code, err.Err)
}

func (err *PermanentError) Unwrap() error {
	return err.Err
}

func Permanent(code string, err error) error {
	return &PermanentError{Code: code, Err: err}
}

func PermanentFailureCode(err error) (string, bool) {
	var permanent *PermanentError
	if !errors.As(err, &permanent) {
		return "", false
	}
	return permanent.Code, true
}
