package messagecodec

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

func Encode(value any) ([]byte, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode JSON: %w", err)
	}
	return payload, nil
}

func Decode[T any](payload []byte) (T, error) {
	var value T
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, fmt.Errorf("decode JSON: %w", err)
	}

	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return value, fmt.Errorf("decode JSON: multiple values")
		}
		return value, fmt.Errorf("decode trailing JSON: %w", err)
	}
	return value, nil
}
