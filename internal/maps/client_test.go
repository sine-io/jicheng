package maps

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func decode(t *testing.T, value string) map[string]any {
	t.Helper()
	d := json.NewDecoder(strings.NewReader(value))
	d.UseNumber()
	var result map[string]any
	if err := d.Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result
}
func TestNormalizeBicycleAndElectricRawTimes(t *testing.T) {
	bicycle := Normalize("cycling", decode(t, `{"data":{"paths":[{"distance":3256,"duration":781,"steps":[{"polyline":"117.2,39.1;117.21,39.11","road":"甲路"}]}]}}`))
	electric := Normalize("electric", decode(t, `{"route":{"paths":[{"distance":"3256","duration":"758","steps":[{"polyline":"117.2,39.1;117.21,39.11","road_name":"甲路"}]},{"distance":"4003","cost":{"duration":"936"},"steps":[{"polyline":"117.2,39.1;117.22,39.12"}]}]}}`))
	if !bicycle.Success() || bicycle.Selected().Minutes != 14 || bicycle.Selected().Seconds != 781 {
		t.Fatalf("bicycle: %+v", bicycle)
	}
	if !electric.Success() || electric.Selected().Minutes != 13 || electric.Selected().Seconds != 758 || len(electric.Alternatives) != 2 {
		t.Fatalf("electric: %+v", electric)
	}
	electric.SelectedID = "route-1"
	if electric.Selected().Distance != 4003 || electric.Selected().Minutes != 16 {
		t.Fatal("alternative fields did not change together")
	}
}
func TestSeparateSegmentsAndInvalidResults(t *testing.T) {
	result := Normalize("driving", decode(t, `{"route":{"paths":[{"duration":"120","distance":"200","tolls":"0","steps":[{"polyline":"117.2,39.1;117.21,39.11"},{"polyline":"117.3,39.2;117.31,39.21"}]},{"duration":"150","distance":"100"}]}}`))
	if !result.Success() || len(result.Alternatives) != 1 || len(result.Selected().Segments) != 2 || result.Selected().Tolls == nil {
		t.Fatalf("bad result: %+v", result)
	}
	for _, payload := range []string{`{"route":{"paths":[]}}`, `{"route":{"paths":[{"distance":"10","steps":[]}]}}`, `{"route":{"paths":[{"duration":"10","distance":"20","steps":[{"polyline":"not a path"}]}]}}`} {
		if Normalize("walking", decode(t, payload)).Success() {
			t.Fatal("must not fabricate routes")
		}
	}
}
func TestTransitRetainsLegsAndProviderOrder(t *testing.T) {
	result := Normalize("transit", decode(t, `{"route":{"transits":[
	  {"cost":{"duration":"1850"},"distance":"5000","walking_distance":"420","segments":[
	    {"walking":{"cost":{"duration":"190"},"steps":[{"polyline":{"polyline":"117.2,39.1;117.21,39.11"}},{"polyline":{"polyline":"117.21,39.11;117.22,39.12"}}]},"entrance":{"name":"B口"},"exit":{"name":"C口"},"bus":{"buslines":[{"type":"地铁线路","name":"地铁5号线(北站--南站)","cost":{"duration":"840"},"departure_stop":{"name":"北站"},"arrival_stop":{"name":"南站"},"via_num":"2","via_stops":[{"name":"中间站甲"},{"name":"中间站乙"}],"polyline":{"polyline":"117.22,39.12;117.3,39.2"}}]}},
	    {"bus":{"buslines":[{"type":"普通公交线路","name":"826路","via_num":"4","polyline":{"polyline":"117.3,39.2;117.32,39.21"}}]}}
	  ]},
	  {"cost":{"duration":"1400"},"distance":"4300","segments":[{"walking":{"steps":[{"polyline":"117.2,39.1;117.23,39.13"}]}}]}
	]}}`))
	if !result.Success() || len(result.Alternatives) != 2 || result.Alternatives[1].Minutes != 24 {
		t.Fatalf("bad transit: %+v", result)
	}
	route := result.Selected()
	if len(route.Segments) != 4 || len(route.Legs) != 3 || route.Minutes != 31 || route.Summary != "地铁5号线 → 826路" || route.WalkDistance == nil || *route.WalkDistance != 420 || route.Transfers == nil || *route.Transfers != 1 {
		t.Fatalf("bad transit summary: %+v", route)
	}
	walk, metro, bus := route.Legs[0], route.Legs[1], route.Legs[2]
	if walk.Kind != "walk" || walk.PathStart != 0 || walk.PathEnd != 2 || walk.Minutes == nil || *walk.Minutes != 4 {
		t.Fatalf("bad walking leg: %+v", walk)
	}
	if metro.Kind != "metro" || metro.PathStart != 2 || metro.PathEnd != 3 || metro.Minutes == nil || *metro.Minutes != 14 || metro.From != "北站" || metro.To != "南站" || metro.Entrance != "B口" || metro.Exit != "C口" || len(metro.Stops) != 2 || metro.Stops[1] != "中间站乙" {
		t.Fatalf("bad metro leg: %+v", metro)
	}
	if bus.Kind != "bus" || bus.PathStart != 3 || bus.PathEnd != 4 || bus.Minutes != nil || bus.ViaCount == nil || *bus.ViaCount != 4 || len(bus.Stops) != 0 {
		t.Fatalf("missing provider values should not be fabricated: %+v", bus)
	}
}
func TestSearchReverseAndStrategyUseWebKey(t *testing.T) {
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "server-test-key" {
			t.Error("missing server key")
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("forwarded credentials")
		}
		calls = append(calls, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v3/place/text":
			io.WriteString(w, `{"status":"1","pois":[{"id":"poi","name":"测试点","location":"117.2,39.1","pname":"天津市","cityname":[],"citycode":"022","adname":"和平区","address":"测试路"}]}`)
		case "/v3/geocode/regeo":
			io.WriteString(w, `{"status":"1","regeocode":{"formatted_address":"天津市测试路","addressComponent":{"city":[],"citycode":"022"}}}`)
		case "/v5/direction/transit/integrated":
			params := r.URL.Query()
			if params.Get("strategy") != "7" || params.Get("city1") != "022" || params.Get("city2") != "010" || params.Get("show_fields") != "cost,polyline" {
				t.Error("lost transit strategy, city codes or route details")
			}
			io.WriteString(w, `{"status":"1","route":{"transits":[{"cost":{"duration":"120"},"distance":"200","segments":[{"walking":{"steps":[{"polyline":"117.2,39.1;117.3,39.2"}]}}]}]}}`)
		default:
			if r.URL.Query().Get("strategy") != "0" {
				t.Error("lost speed strategy 0")
			}
			io.WriteString(w, `{"status":"1","route":{"paths":[{"duration":"120","distance":"200","steps":[{"polyline":"117.2,39.1;117.21,39.11"}]}]}}`)
		}
	}))
	defer server.Close()
	client := NewClient("server-test-key")
	client.base = server.URL
	client.spacing = 0
	places, err := client.Search(context.Background(), "测试点", "")
	if err != nil || len(places) != 1 || places[0].City != "022" {
		t.Fatalf("bad search: %+v %v", places, err)
	}
	point, err := client.Reverse(context.Background(), Point{117.2, 39.1})
	if err != nil || point.City != "022" {
		t.Fatal(err)
	}
	result := client.Route(context.Background(), places[0], Place{Point: Point{117.3, 39.2}}, "driving", 0)
	if !result.Success() || len(calls) != 3 {
		t.Fatalf("bad calls: %+v", result)
	}
	result = client.Route(context.Background(), places[0], Place{Point: Point{117.3, 39.2}, City: "010"}, "transit", 7)
	if !result.Success() || len(calls) != 4 || calls[3] != "/v5/direction/transit/integrated" {
		t.Fatalf("bad transit request: %+v", result)
	}
}
func TestCancelledQueueAndNoSecretInNetworkError(t *testing.T) {
	client := NewClient("sensitive-test-value")
	client.base = "http://127.0.0.1:1"
	client.spacing = time.Second
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := client.Search(ctx, "x", "")
	if err == nil || strings.Contains(err.Error(), "sensitive-test-value") {
		t.Fatal("invalid cancellation handling")
	}
	_, err = client.Search(context.Background(), "x", "")
	if err == nil || strings.Contains(err.Error(), "sensitive-test-value") {
		t.Fatal("error leaked request URL")
	}
}
