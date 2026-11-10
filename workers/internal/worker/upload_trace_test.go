package worker

import "testing"

func TestUploadTraceSamplesEveryHundredthCrockfordSuffix(t *testing.T) {
	cases := map[string]bool{
		"01J00000000000000000000000": true,
		"01J00000000000000000000034": true,
		"01J0000000000000000000009C": true,
		"01J00000000000000000000001": false,
		"01J00000000000000000000035": false,
		"asset-1":                    false,
		"0":                          false,
	}
	for assetID, sampled := range cases {
		if got := uploadTraceSampled(assetID); got != sampled {
			t.Errorf("uploadTraceSampled(%q) = %t, want %t", assetID, got, sampled)
		}
	}
}
