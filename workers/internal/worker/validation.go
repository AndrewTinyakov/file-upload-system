package worker

import (
	"fmt"
	"regexp"
)

var ulidPattern = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)

func ValidateULID(name, value string) error {
	if !ulidPattern.MatchString(value) {
		return fmt.Errorf("%s must be a ULID", name)
	}
	return nil
}
