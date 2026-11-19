package app

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSaveAMapSettings(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	const otherSettings = "# Local configuration\r\nLISTEN_ADDR=127.0.0.1:4173\r\nOTHER='first line\r\nAMAP_JS_KEY=part-of-other-value\r\nlast line'\r\n"
	if err := os.WriteFile(path, []byte(otherSettings+"export AMAP_JS_KEY='old-public' # old\r\nAMAP_JS_KEY=old-duplicate\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	a := New(Config{LocalEnvFile: path}, nil)
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	browser := newBrowser(t, server.URL)
	values := url.Values{"js_key": {"public-key"}, "security_code": {"private-security"}, "web_key": {"private-web"}}
	csrf := browser.csrf
	browser.csrf = "wrong"
	if status, _ := browser.post("save-map-settings", values); status != 403 {
		t.Fatalf("invalid CSRF accepted: %d", status)
	}
	browser.csrf = csrf
	values.Set("web_key", "invalid\nGO_PROXY_TOKEN=injected")
	if status, body := browser.post("save-map-settings", values); status != 200 || !strings.Contains(body, `role="alert"`) || strings.Contains(body, "injected") {
		t.Fatal("unsafe key was not rejected without reflection")
	}
	unchanged, _ := os.ReadFile(path)
	if !strings.Contains(string(unchanged), "old-duplicate") || strings.Contains(string(unchanged), "injected") {
		t.Fatal("invalid save altered the file")
	}
	values.Set("web_key", "private-web")
	status, body := browser.post("save-map-settings", values)
	if status != 200 || !strings.Contains(body, "已保存到 .env") || !strings.Contains(body, `id="search"`) || strings.Contains(body, `id="route-map"`) || browser.state()["configured"] != true {
		t.Fatal("save did not activate settings via targeted fragments")
	}
	data, err := os.ReadFile(path)
	if err != nil || !strings.HasPrefix(string(data), otherSettings) || strings.Contains(string(data), "old-public") || strings.Contains(string(data), "old-duplicate") {
		t.Fatal("save did not retain unrelated settings or remove old keys")
	}
	t.Setenv("AMAP_JS_KEY", "fallback-public")
	t.Setenv("AMAP_WEB_SERVICE_KEY", "fallback-web")
	loaded, err := LoadConfig(path)
	if err != nil || loaded.JSKey != values.Get("js_key") || loaded.SecurityCode != values.Get("security_code") || loaded.WebKey != values.Get("web_key") {
		t.Fatal("saved keys did not load back from .env")
	}
	for _, route := range []string{"/", "/api/maps/config"} {
		response, err := browser.client.Get(server.URL + route)
		if err != nil {
			t.Fatal(err)
		}
		payload, err := io.ReadAll(response.Body)
		response.Body.Close()
		body += string(payload)
		if err != nil || response.StatusCode != 200 || route == "/api/maps/config" && !strings.Contains(string(payload), `"jsKey":"public-key"`) {
			t.Fatal("saved map settings not available")
		}
	}
	if strings.Contains(body, loaded.SecurityCode) || strings.Contains(body, loaded.WebKey) {
		t.Fatal("private map credentials were reflected")
	}
}

func TestMapSettingsRequireDirectLoopback(t *testing.T) {
	for _, test := range []struct {
		name, host, peer, forwarding, token, path string
		allowed                                   bool
	}{
		{"local", "127.0.0.1:4173", "127.0.0.1:5533", "", "", ".env", true},
		{"IPv6", "[::1]:4173", "[::1]:5533", "", "", ".env", true},
		{"nonlocal listener", "localhost:4173", "127.0.0.1:5533", "", "", "", false},
		{"remote peer", "localhost:4173", "192.0.2.1:5533", "", "", ".env", false},
		{"external host", "example.test", "127.0.0.1:5533", "", "", ".env", false},
		{"forwarded", "127.0.0.1:4173", "127.0.0.1:5533", "192.0.2.1", "", ".env", false},
		{"gateway", "127.0.0.1:4173", "127.0.0.1:5533", "", "test-token", ".env", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			a := &App{config: Config{LocalEnvFile: test.path, ProxyToken: test.token}}
			request := httptest.NewRequest(http.MethodPost, "http://"+test.host+"/ui/save-map-settings", nil)
			request.RemoteAddr = test.peer
			request.Header.Set("X-Forwarded-For", test.forwarding)
			if a.canEditMap(request) != test.allowed {
				t.Fatal("incorrect map configuration access")
			}
		})
	}
}

func TestChangingWebKeyCancelsOldRoutes(t *testing.T) {
	provider := &fixtureProvider{block: true, started: make(chan struct{}, 5)}
	a := New(Config{JSKey: "public", SecurityCode: "code", WebKey: "old-web", LocalEnvFile: filepath.Join(t.TempDir(), ".env")}, provider)
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	browser := newBrowser(t, server.URL)
	browser.add("origin", "测试起点")
	browser.add("destination", "测试终点")
	finished := make(chan int, 1)
	go func() { status, _ := browser.post("query", nil); finished <- status }()
	select {
	case <-provider.started:
	case <-time.After(3 * time.Second):
		t.Fatal("query did not start")
	}
	status, body := browser.post("save-map-settings", url.Values{"js_key": {"new-public"}, "security_code": {"code"}, "web_key": {"new-web"}})
	if status != 200 || !strings.Contains(body, "刷新页面后会应用") {
		t.Fatal("rotation did not account for the already-loaded JS SDK")
	}
	select {
	case status := <-finished:
		if status != 204 {
			t.Fatalf("stale query returned %d", status)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("old request not cancelled")
	}
	state := browser.state()
	if len(state["origins"].([]any)) != 1 || len(state["destinations"].([]any)) != 1 {
		t.Fatal("changing keys discarded locations")
	}
}
