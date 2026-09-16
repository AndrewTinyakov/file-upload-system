package worker

import (
	"errors"
	"fmt"
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
