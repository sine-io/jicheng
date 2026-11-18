package app

import (
	"context"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"jicheng/internal/maps"
)

type fixtureProvider struct {
	mu      sync.Mutex
	calls   int
	block   bool
	started chan struct{}
}

func (f *fixtureProvider) Search(_ context.Context, q, city string) ([]maps.Place, error) {
	return []maps.Place{{ProviderID: q, Name: q, Address: "天津市测试地址", City: "022", Point: maps.Point{117.2, 39.1}}, {ProviderID: q + "2", Name: q + "另一个地点", City: "022", Point: maps.Point{117.3, 39.2}}}, nil
}
func (f *fixtureProvider) Reverse(_ context.Context, p maps.Point) (maps.Place, error) {
	return maps.Place{Name: "地图选择地点", Address: "天津市测试路", City: "022", Point: p}, nil
}
func (f *fixtureProvider) Route(ctx context.Context, from, to maps.Place, mode string, policy int) maps.Result {
	f.mu.Lock()
	f.calls++
	block := f.block
	started := f.started
	f.mu.Unlock()
	if block {
		select {
		case started <- struct{}{}:
		default:
		}
		<-ctx.Done()
		return maps.Result{Status: "error", Reason: "cancelled"}
	}
	return maps.Result{Status: "success", Alternatives: []maps.Route{{ID: "route-0", Index: 0, Minutes: 30, Seconds: 1800, Distance: 5000, Segments: [][]maps.Point{{from.Point, to.Point}}}, {ID: "route-1", Index: 1, Minutes: 20, Seconds: 1200, Distance: 4000, Segments: [][]maps.Point{{from.Point, {117.4, 39.3}, to.Point}}}}}
}

type browser struct {
	client                *http.Client
	base, workspace, csrf string
	t                     *testing.T
}

func newBrowser(t *testing.T, base string) *browser {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	b := &browser{client: &http.Client{Jar: jar}, base: base, t: t}
	b.refresh()
	return b
}
func (b *browser) refresh() {
	b.t.Helper()
	t := b.t
	base := b.base
	response, err := b.client.Get(base + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	for name, target := range map[string]*string{"workspace": &b.workspace, "csrf": &b.csrf} {
		match := regexp.MustCompile(`name="` + name + `" value="([^"]+)"`).FindSubmatch(body)
		if len(match) != 2 {
			t.Fatalf("missing %s in page", name)
		}
		*target = string(match[1])
	}
	if !strings.Contains(string(body), "<!doctype html>") && !strings.Contains(string(body), "<!DOCTYPE html>") {
		t.Fatal("initial page is not server-rendered")
	}
}
func (b *browser) post(action string, values url.Values) (int, string) {
	b.t.Helper()
	if values == nil {
		values = url.Values{}
	}
	values.Set("workspace", b.workspace)
	values.Set("csrf", b.csrf)
	request, _ := http.NewRequest(http.MethodPost, b.base+"/ui/"+action, strings.NewReader(values.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("HX-Request", "true")
	request.Header.Set("Origin", b.base)
	response, err := b.client.Do(request)
	if err != nil {
		b.t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return response.StatusCode, string(body)
}
func (b *browser) add(kind, name string) {
	b.t.Helper()
	for _, call := range []struct {
		action string
		values url.Values
	}{{"open-editor", url.Values{"kind": {kind}}}, {"search-editor", url.Values{"query": {name}}}, {"select-place", url.Values{"choice": {"0"}}}, {"save-place", url.Values{"name": {name}}}} {
		status, body := b.post(call.action, call.values)
		if status != 200 {
			b.t.Fatalf("%s status %d: %s", call.action, status, body)
		}
	}
}
func (b *browser) state() map[string]any {
	b.t.Helper()
	response, err := b.client.Get(b.base + "/api/map-state?workspace=" + b.workspace)
	if err != nil {
		b.t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		b.t.Fatal(err)
	}
	return result
}
func newTestApp(t *testing.T) (*App, *fixtureProvider, *httptest.Server, *browser) {
	f := &fixtureProvider{started: make(chan struct{}, 10)}
	application := New(Config{JSKey: "public-test-key", SecurityCode: "private-test-code", WebKey: "private-web-key"}, f)
	server := httptest.NewServer(application.Handler())
	t.Cleanup(server.Close)
	return application, f, server, newBrowser(t, server.URL)
}
func TestPartialCRUDAndAlternativeUpdates(t *testing.T) {
	_, f, _, b := newTestApp(t)
	b.add("origin", "出发地一")
	b.add("destination", "目的地甲")
	b.add("destination", "目的地乙")
	status, body := b.post("query", nil)
	if status != 200 || strings.Contains(body, "<html") || strings.Contains(body, `id="route-map"`) || !strings.Contains(body, "hx-swap-oob") {
		t.Fatal("query should return targeted HTML fragments")
	}
	f.mu.Lock()
	calls := f.calls
	f.mu.Unlock()
	if calls != 10 {
		t.Fatalf("expected five travel modes for two destinations, got %d", calls)
	}
	state := b.state()
	dest := state["destinations"].([]any)[0].(map[string]any)
	id := dest["id"].(string)
	status, body = b.post("select-mode", url.Values{"id": {id}, "mode": {"electric"}})
	if status != 200 || !strings.Contains(body, "方案") {
		t.Fatal("missing route alternatives")
	}
	b.post("select-route", url.Values{"id": {id}, "mode": {"electric"}, "route": {"route-1"}})
	state = b.state()
	result := state["destinations"].([]any)[0].(map[string]any)["route"].(map[string]any)
	if result["selectedId"] != "route-1" {
		t.Fatal("alternative selection not retained")
	}
	b.post("delete-place", url.Values{"id": {id}, "kind": {"destination"}})
	if len(b.state()["destinations"].([]any)) != 1 {
		t.Fatal("delete failed")
	}
	b.post("undo", nil)
	if len(b.state()["destinations"].([]any)) != 2 {
		t.Fatal("undo failed")
	}
}
func TestSwitchOriginsSharesDestinationsAndCancelsOldQuery(t *testing.T) {
	_, f, _, b := newTestApp(t)
	b.add("origin", "出发地一")
	b.add("destination", "目的地甲")
	b.add("origin", "出发地二")
	state := b.state()
	if len(state["destinations"].([]any)) != 1 {
		t.Fatal("destinations should be shared")
	}
	f.mu.Lock()
	f.block = true
	f.mu.Unlock()
	finished := make(chan int, 1)
	go func() { status, _ := b.post("query", nil); finished <- status }()
	select {
	case <-f.started:
	case <-time.After(3 * time.Second):
		t.Fatal("query not started")
	}
	b.post("policy", url.Values{"policy": {"12"}})
	select {
	case status := <-finished:
		if status != 204 {
			t.Fatalf("stale query returned %d", status)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("query was not cancelled")
	}
	state = b.state()
	if state["destinations"].([]any)[0].(map[string]any)["route"].(map[string]any)["status"] != "pending" {
		t.Fatal("old results overwrote new query state")
	}
}
func TestSessionCSRFAndTemplateEscaping(t *testing.T) {
	_, _, server, b := newTestApp(t)
	label := `<script>alert(1)</script>`
	b.add("origin", label)
	origin := b.state()["origin"].(map[string]any)
	status, body := b.post("activate-origin", url.Values{"id": {origin["id"].(string)}})
	if status != 200 || strings.Contains(body, label) || !strings.Contains(body, html.EscapeString(label)) {
		t.Fatal("unescaped place label")
	}
	other := newBrowser(t, server.URL)
	other.workspace = b.workspace
	other.csrf = b.csrf
	status, _ = other.post("policy", url.Values{"policy": {"12"}})
	if status != 403 {
		t.Fatal("cross-session workspace accepted")
	}
	b.csrf = "wrong"
	status, _ = b.post("policy", url.Values{"policy": {"12"}})
	if status != 403 {
		t.Fatal("invalid CSRF accepted")
	}
	response, _ := b.client.Get(server.URL + "/api/maps/config")
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if strings.Contains(string(data), "private-web-key") || strings.Contains(string(data), "private-test-code") {
		t.Fatal("private key exposed")
	}
}
func TestMapSelectionAndSSRRefreshIsolation(t *testing.T) {
	_, _, _, b := newTestApp(t)
	b.post("start-pick", url.Values{"quick": {"true"}})
	b.post("pick", url.Values{"point": {"117.2,39.1"}})
	if b.state()["origin"] != nil || b.state()["preview"] == nil {
		t.Fatal("map selection should preview without creating a location")
	}
	b.post("assign-place", url.Values{"kind": {"origin"}})
	if b.state()["origin"] == nil {
		t.Fatal("confirmed map selection did not create an origin")
	}
	previous := b.workspace
	b.refresh()
	if b.workspace == previous || b.state()["origin"] != nil {
		t.Fatal("page refresh should start a separate workspace")
	}
}

func TestUnifiedSearchAndMultipleOriginAssignment(t *testing.T) {
	_, f, _, b := newTestApp(t)
	status, body := b.post("submit", url.Values{"query": {"天津站"}})
	if status != 200 || !strings.Contains(body, "地点搜索结果") {
		t.Fatal("missing search results")
	}
	b.post("inspect-place", url.Values{"choice": {"0"}})
	state := b.state()
	if state["origin"] != nil || state["preview"] == nil || len(state["destinations"].([]any)) != 0 {
		t.Fatal("inspection mutated the saved places")
	}
	b.post("assign-place", url.Values{"kind": {"destination"}})
	if b.state()["origin"] != nil || len(b.state()["destinations"].([]any)) != 1 {
		t.Fatal("must support a destination before any origin")
	}
	b.post("inspect-point", url.Values{"point": {"117.15,39.15"}})
	b.post("assign-place", url.Values{"kind": {"origin"}})
	first := b.state()["origin"].(map[string]any)["id"].(string)
	b.post("inspect-point", url.Values{"point": {"117.25,39.25"}})
	b.post("assign-place", url.Values{"kind": {"origin"}})
	state = b.state()
	if len(state["origins"].([]any)) != 2 || state["origin"].(map[string]any)["id"] == first {
		t.Fatal("adding another origin replaced the first")
	}
	b.post("inspect-point", url.Values{"point": {"117.35,39.35"}})
	b.post("assign-place", url.Values{"kind": {"destination"}})
	b.post("activate-origin", url.Values{"id": {first}})
	state = b.state()
	if state["origin"].(map[string]any)["id"] != first || len(state["destinations"].([]any)) != 2 {
		t.Fatal("switching origins must preserve the shared destinations")
	}
	b.post("query", nil)
	f.mu.Lock()
	calls := f.calls
	f.mu.Unlock()
	if calls != 10 {
		t.Fatalf("expected two destinations with five modes, got %d calls", calls)
	}
	b.post("submit", url.Values{"query": {"地图选择地点"}})
	f.mu.Lock()
	after := f.calls
	f.mu.Unlock()
	if after != calls || b.state()["origin"].(map[string]any)["id"] != first {
		t.Fatal("search must not query routes or replace an origin")
	}
	b.post("inspect-point", url.Values{"point": {"117.25,39.25"}})
	b.post("assign-place", url.Values{"kind": {"origin"}})
	if len(b.state()["origins"].([]any)) != 2 {
		t.Fatal("duplicate origin was appended")
	}
	b.post("inspect-point", url.Values{"point": {"117.45,39.45"}})
	b.post("clear-search", nil)
	b.post("assign-place", url.Values{"kind": {"destination"}})
	if len(b.state()["destinations"].([]any)) != 2 {
		t.Fatal("dismissed preview was saved")
	}
}
