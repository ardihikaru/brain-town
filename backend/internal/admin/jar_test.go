package admin_test

import "net/http/cookiejar"

func cookieJar() (*cookiejar.Jar, error) { return cookiejar.New(nil) }
