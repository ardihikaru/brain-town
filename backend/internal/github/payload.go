package github

import (
	"strings"
)

// Small accessors over the decoded GitHub payload. Only the fields the town needs are ever read,
// and none of them (other than titles for public repos) are kept.

func obj(m map[string]any, path ...string) map[string]any {
	for _, k := range path {
		n, _ := m[k].(map[string]any)
		if n == nil {
			return nil
		}
		m = n
	}
	return m
}

func str(m map[string]any, k string) string {
	s, _ := m[k].(string)
	return s
}

func num(m map[string]any, k string) (int, bool) {
	f, ok := m[k].(float64)
	return int(f), ok
}

func boolean(m map[string]any, k string) bool {
	b, _ := m[k].(bool)
	return b
}

// id renders a JSON number (issue number, run id) as a string without exponent or decimals.
func id(m map[string]any, k string) string {
	f, ok := m[k].(float64)
	if !ok {
		return ""
	}
	return itoa(int64(f))
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

func strList(v any) []string {
	a, _ := v.([]any)
	out := make([]string, 0, len(a))
	for _, x := range a {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func isBot(p map[string]any) bool {
	s := obj(p, "sender")
	return str(s, "type") == "Bot" || strings.HasSuffix(str(s, "login"), "[bot]")
}
