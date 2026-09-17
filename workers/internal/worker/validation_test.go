package worker

import "testing"

func TestValidateULID(t *testing.T) {
	if err := ValidateULID("command ID", "01ARZ3NDEKTSV4RRFFQ69G5FAV"); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"", "command-1", "01arz3ndektsv4rrffq69g5fav", "01ARZ3NDEKTSV4RRFFQ69G5FAI"} {
		if err := ValidateULID("command ID", value); err == nil {
			t.Fatalf("ValidateULID(%q) error = nil", value)
		}
	}
}
