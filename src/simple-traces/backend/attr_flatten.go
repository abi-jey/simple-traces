package backend

import (
	"encoding/json"
	"strings"
)

// FlattenAttrs flattens a nested map[string]any into dot-notated keys.
// Arrays and non-map values are left as-is. Example: {"gen_ai": {"system": "x"}} -> {"gen_ai.system": "x"}
func FlattenAttrs(in map[string]any) map[string]any {
	out := make(map[string]any)
	flattenInto("", in, out)
	return out
}

// FlattenAttrsWithTrace works like FlattenAttrs but also returns a list of keys
// that were produced by flattening nested objects (i.e., keys containing dots).
// This is useful for debug logging to reveal implicit key renames.
func FlattenAttrsWithTrace(in map[string]any) (map[string]any, []string) {
	out := make(map[string]any)
	var produced []string
	flattenIntoWithTrace("", in, out, &produced)
	return out, produced
}

func flattenInto(prefix string, val any, out map[string]any) {
	switch m := val.(type) {
	case map[string]any:
		for k, v := range m {
			key := k
			if prefix != "" {
				key = prefix + "." + k
			}
			// Recurse only for nested objects; arrays remain as-is
			switch v.(type) {
			case map[string]any:
				flattenInto(key, v, out)
			default:
				out[key] = v
			}
		}
	default:
		if prefix != "" {
			out[prefix] = val
		}
	}
}

func flattenIntoWithTrace(prefix string, val any, out map[string]any, produced *[]string) {
	switch m := val.(type) {
	case map[string]any:
		for k, v := range m {
			key := k
			if prefix != "" {
				key = prefix + "." + k
			}
			switch v.(type) {
			case map[string]any:
				flattenIntoWithTrace(key, v, out, produced)
			default:
				out[key] = v
				if strings.Contains(key, ".") { // produced by flattening a nested object
					*produced = append(*produced, key)
				}
			}
		}
	default:
		if prefix != "" {
			out[prefix] = val
			if strings.Contains(prefix, ".") {
				*produced = append(*produced, prefix)
			}
		}
	}
}

// AttrType returns a consistent string type for an attribute value.
// string|int|float|bool|array|object|null
func AttrType(v any) string {
	if v == nil {
		return "null"
	}
	switch vv := v.(type) {
	case string:
		return "string"
	case bool:
		return "bool"
	case int, int8, int16, int32, int64:
		return "int"
	case uint, uint8, uint16, uint32, uint64:
		return "int"
	case float32, float64:
		return "float"
	case json.Number:
		// Try to see if it's an integer
		if _, err := vv.Int64(); err == nil {
			return "int"
		}
		return "float"
	case []any, []string, []int, []int64, []float64, []bool:
		return "array"
	case map[string]any:
		return "object"
	default:
		// try JSON marshal to see if it's an object/array
		if _, err := json.Marshal(v); err == nil {
			// not strictly accurate, but safe default
			return "object"
		}
		return "string"
	}
}
