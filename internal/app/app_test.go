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
	calls   []routeCall
	block   bool
	started chan struct{}
	release chan struct{}
}
type routeCall struct {
	mode   string
	policy int
}

func (f *fixtureProvider) Search(_ context.Context, q, city string) ([]maps.Place, error) {
	return []maps.Place{{ProviderID: q, Name: q, Address: "天津市测试地址", City: "022", Point: maps.Point{117.2, 39.1}}, {ProviderID: q + "2", Name: q + "另一个地点", City: "022", Point: maps.Point{117.3, 39.2}}}, nil
}
func (f *fixtureProvider) Reverse(_ context.Context, p maps.Point) (maps.Place, error) {
	return maps.Place{Name: "地图选择地点", Address: "天津市测试路", City: "022", Point: p}, nil
}
func (f *fixtureProvider) Route(ctx context.Context, from, to maps.Place, mode string, policy int) maps.Result {
	f.mu.Lock()
	f.calls = append(f.calls, routeCall{mode, policy})
	block := f.block
	started := f.started
	release := f.release
	f.mu.Unlock()
	if block {
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-ctx.Done():
			return maps.Result{Status: "error", Reason: "cancelled"}
		case <-release:
		}
	}
	result := maps.Result{Status: "success", Alternatives: []maps.Route{{ID: "route-0", Index: 0, Minutes: 30, Seconds: 1800, Distance: 5000, Segments: [][]maps.Point{{from.Point, to.Point}}}, {ID: "route-1", Index: 1, Minutes: 20, Seconds: 1200, Distance: 4000, Segments: [][]maps.Point{{from.Point, {117.4, 39.3}, to.Point}}}}}
	if mode == "transit" {
		minutes, count := 18, 1
		result.Alternatives[0].Legs = []maps.TransitLeg{{Kind: "metro", Name: "地铁5号线", From: "出发站", To: "到达站", Minutes: &minutes, ViaCount: &count, Stops: []string{"<测试站>"}, PathEnd: 1}}
	}
	return result
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
	calls := len(f.calls)
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
	b.post("policy", url.Values{"mode": {"driving"}, "policy": {"12"}})
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
func TestTransitPreferenceRequeriesOnlyTransit(t *testing.T) {
	_, f, _, b := newTestApp(t)
	b.add("origin", "出发地")
	b.add("destination", "目的地甲")
	b.add("destination", "目的地乙")
	_, overview := b.post("query", nil)
	if strings.Contains(overview, `id="route-policy"`) {
		t.Fatal("overview should not show any mode preference")
	}
	id := b.state()["destinations"].([]any)[0].(map[string]any)["id"].(string)
	_, transit := b.post("select-mode", url.Values{"id": {id}, "mode": {"transit"}})
	if !strings.Contains(transit, "<span>公交·地铁</span>") || !strings.Contains(transit, "公交·地铁偏好") || !strings.Contains(transit, "地铁优先") || !strings.Contains(transit, "查看行程") || !strings.Contains(transit, "18 分钟") || !strings.Contains(transit, "&lt;测试站&gt;") || strings.Contains(transit, "驾车偏好") {
		t.Fatal("transit preference or escaped itinerary missing")
	}
	status, _ := b.post("policy", url.Values{"mode": {"transit"}, "policy": {"14"}})
	if status != http.StatusBadRequest {
		t.Fatal("driving-only strategy accepted for transit")
	}
	status, waiting := b.post("policy", url.Values{"mode": {"transit"}, "policy": {"7"}})
	if status != http.StatusOK || !strings.Contains(waiting, "正在查询公交·地铁路线") || !strings.Contains(waiting, `value="7" selected`) {
		t.Fatal("mode panel should stay open with the new policy while pending")
	}
	f.mu.Lock()
	f.calls = nil
	f.started = make(chan struct{}, 10)
	release := make(chan struct{})
	f.release = release
	f.block = true
	f.mu.Unlock()
	defer func() {
		if release != nil {
			close(release)
		}
	}()
	finished := make(chan int, 1)
	go func() { status, _ := b.post("query", nil); finished <- status }()
	select {
	case <-f.started:
	case <-time.After(3 * time.Second):
		t.Fatal("query not started")
	}
	_, driving := b.post("select-mode", url.Values{"id": {id}, "mode": {"driving"}})
	if !strings.Contains(driving, "驾车偏好") || strings.Contains(driving, "地铁优先") {
		t.Fatal("driving panel should show only driving preferences")
	}
	b.post("select-route", url.Values{"id": {id}, "mode": {"driving"}, "route": {"route-1"}})
	close(release)
	release = nil
	select {
	case status := <-finished:
		if status != http.StatusOK {
			t.Fatalf("query returned %d", status)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("query did not finish")
	}
	f.mu.Lock()
	calls := append([]routeCall(nil), f.calls...)
	f.mu.Unlock()
	if len(calls) != 2 || calls[0] != (routeCall{"transit", 7}) || calls[1] != (routeCall{"transit", 7}) {
		t.Fatalf("wrong modes or strategies refreshed: %+v", calls)
	}
	result := b.state()["destinations"].([]any)[0].(map[string]any)["route"].(map[string]any)
	if result["selectedId"] != "route-1" {
		t.Fatal("transit query must preserve a driving alternative selected while it ran")
	}
	_, walking := b.post("select-mode", url.Values{"id": {id}, "mode": {"walking"}})
	if strings.Contains(walking, `id="route-policy"`) {
		t.Fatal("walking should not show a preference")
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
func TestLocationHelpLinksToWindowsSettings(t *testing.T) {
	application := New(Config{}, &fixtureProvider{})
	response := httptest.NewRecorder()
	application.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `href="ms-settings:privacy-location"`) {
		t.Fatal("page must provide a usable Windows location settings link")
	}
}

func TestCoordinateConversionProxy(t *testing.T) {
	application := New(Config{JSKey: "public-test-key", SecurityCode: "private-test-code"}, &fixtureProvider{})
	handler := application.Handler()
	for path, want := range map[string]int{
		"/v3/assistant/coordinate/convert": http.StatusBadRequest,
		"/v4/assistant/coordinate/convert": http.StatusNotFound,
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/_AMapService"+path+"?callback=invalid()", nil)
		handler.ServeHTTP(response, request)
		if response.Code != want {
			t.Errorf("%s returned %d, want %d", path, response.Code, want)
		}
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
	calls := len(f.calls)
	f.mu.Unlock()
	if calls != 10 {
		t.Fatalf("expected two destinations with five modes, got %d calls", calls)
	}
	b.post("submit", url.Values{"query": {"地图选择地点"}})
	f.mu.Lock()
	after := len(f.calls)
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
