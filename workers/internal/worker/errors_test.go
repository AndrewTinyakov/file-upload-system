package worker

import (
	"errors"
	"testing"
)

func TestPermanentFailureCode(t *testing.T) {
	err := Permanent("INVALID_IMAGE", errors.New("cannot decode input"))

	code, ok := PermanentFailureCode(err)
	if !ok || code != "INVALID_IMAGE" {
		t.Fatalf("PermanentFailureCode() = %q, %t, want INVALID_IMAGE, true", code, ok)
	}
}
