package maps

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Client struct {
	key     string
	http    *http.Client
	base    string
	sem     chan struct{}
	mu      sync.Mutex
	next    time.Time
	spacing time.Duration
}

func NewClient(key string) *Client {
	return &Client{key: key, http: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, base: "https://restapi.amap.com", sem: make(chan struct{}, 2), spacing: 420 * time.Millisecond}
}
func (c *Client) acquire(ctx context.Context) error {
	select {
	case c.sem <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	c.mu.Lock()
	at := c.next
	if at.Before(time.Now()) {
		at = time.Now()
	}
	c.next = at.Add(c.spacing)
	c.mu.Unlock()
	timer := time.NewTimer(time.Until(at))
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		<-c.sem
		return ctx.Err()
	}
}
func (c *Client) get(ctx context.Context, path string, params url.Values) (map[string]any, error) {
	if c.key == "" {
		return nil, fmt.Errorf("地图服务尚未配置 Web 服务 Key")
	}
	if err := c.acquire(ctx); err != nil {
		return nil, err
	}
	defer func() { <-c.sem }()
	params.Set("key", c.key)
	params.Set("output", "json")
	u := c.base + path + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("地图请求失败")
	}
	req.Header.Set("Accept", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("高德服务连接失败，请重试")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("高德服务暂不可用，请重试")
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 12<<20))
	decoder.UseNumber()
	var data map[string]any
	if decoder.Decode(&data) != nil {
		return nil, fmt.Errorf("高德返回了无法解析的数据")
	}
	if s(data["status"]) == "1" {
		return data, nil
	}
	if code, ok := data["errcode"]; ok && s(code) == "0" {
		return data, nil
	}
	code := s(data["info"])
	if code == "" {
		code = s(data["errmsg"])
	}
	return nil, fmt.Errorf("%s", Failure(code).Reason)
}
func (c *Client) Search(ctx context.Context, query, city string) ([]Place, error) {
	if strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("请输入地点名称")
	}
	if city == "" {
		city = "全国"
	}
	data, err := c.get(ctx, "/v3/place/text", url.Values{"keywords": {query}, "city": {city}, "citylimit": {"false"}, "offset": {"8"}, "page": {"1"}, "extensions": {"all"}})
	if err != nil {
		return nil, err
	}
	places := []Place{}
	for _, value := range a(data["pois"]) {
		p := o(value)
		point, err := ParsePoint(s(p["location"]))
		if err != nil {
			continue
		}
		city := s(p["citycode"])
		if city == "" {
			city = s(p["cityname"])
		}
		if city == "" {
			city = s(p["adcode"])
		}
		parts := unique([]string{s(p["pname"]), s(p["cityname"]), s(p["adname"]), s(p["address"])})
		places = append(places, Place{ProviderID: s(p["id"]), Name: s(p["name"]), Address: strings.Join(parts, " "), City: city, Point: point})
	}
	return places, nil
}
func (c *Client) Reverse(ctx context.Context, point Point) (Place, error) {
	data, err := c.get(ctx, "/v3/geocode/regeo", url.Values{"location": {point.String()}, "extensions": {"base"}})
	if err != nil {
		return Place{}, err
	}
	r := o(data["regeocode"])
	component := o(r["addressComponent"])
	address := s(r["formatted_address"])
	if address == "" {
		return Place{}, fmt.Errorf("未识别到此位置的地址，请换个位置")
	}
	city := s(component["citycode"])
	if city == "" {
		city = s(component["city"])
	}
	if city == "" {
		city = s(component["province"])
	}
	return Place{Name: address, Address: address, City: city, Point: point}, nil
}
func (c *Client) Route(ctx context.Context, origin, destination Place, mode string, policy int) Result {
	if origin.Point == destination.Point {
		return Result{Status: "success", Alternatives: []Route{{ID: "route-0", Segments: [][]Point{}, Summary: "起终点相同"}}}
	}
	path := ""
	params := url.Values{"origin": {origin.Point.String()}, "destination": {destination.Point.String()}}
	switch mode {
	case "driving":
		path = "/v3/direction/driving"
		params.Set("strategy", strconv.Itoa(policy))
		params.Set("extensions", "all")
	case "transit":
		if origin.City == "" || destination.City == "" {
			return Result{Status: "error", Reason: "地点缺少城市信息，请重新设置地点"}
		}
		path = "/v3/direction/transit/integrated"
		params.Set("city", origin.City)
		params.Set("cityd", destination.City)
		params.Set("extensions", "all")
	case "cycling":
		path = "/v4/direction/bicycling"
	case "electric":
		path = "/v5/direction/electrobike"
		params.Set("alternative_route", "3")
		params.Set("show_fields", "cost,polyline")
	case "walking":
		path = "/v3/direction/walking"
	default:
		return Result{Status: "error", Reason: "不支持的出行方式"}
	}
	data, err := c.get(ctx, path, params)
	if err != nil {
		return Result{Status: "error", Reason: err.Error()}
	}
	return Normalize(mode, data)
}
func Normalize(mode string, data map[string]any) Result {
	root := o(data["route"])
	if mode == "cycling" {
		root = o(data["data"])
	}
	paths := a(root["paths"])
	if mode == "transit" {
		paths = a(root["transits"])
	}
	if len(paths) == 0 {
		return Result{Status: "no-route", Reason: "高德未返回可用路线"}
	}
	routes := []Route{}
	for index, value := range paths {
		p := o(value)
		duration := p["duration"]
		if duration == nil {
			duration = o(p["cost"])["duration"]
		}
		seconds, distance := n(duration), n(p["distance"])
		if math.IsNaN(seconds) || math.IsNaN(distance) || seconds < 0 || distance < 0 {
			continue
		}
		segments := [][]Point{}
		roads := []string{}
		add := func(poly any) {
			points := parsePolyline(s(poly))
			if len(points) > 1 {
				segments = append(segments, points)
			}
		}
		if mode == "transit" {
			for _, sv := range a(p["segments"]) {
				sg := o(sv)
				for _, step := range a(o(sg["walking"])["steps"]) {
					add(o(step)["polyline"])
				}
				lines := a(o(sg["bus"])["buslines"])
				if len(lines) > 0 {
					line := o(lines[0])
					add(line["polyline"])
					roads = append(roads, s(line["name"]))
				}
				taxi := o(sg["taxi"])
				add(taxi["polyline"])
			}
		} else {
			for _, step := range a(p["steps"]) {
				st := o(step)
				add(st["polyline"])
				road := s(st["road_name"])
				if road == "" {
					road = s(st["road"])
				}
				roads = append(roads, road)
			}
		}
		if distance > 0 && len(segments) == 0 {
			continue
		}
		roads = unique(roads)
		if len(roads) > 3 {
			roads = roads[:3]
		}
		route := Route{ID: fmt.Sprintf("route-%d", index), Index: index, Minutes: int(math.Ceil(seconds / 60)), Seconds: seconds, Distance: distance, Segments: segments, Summary: strings.Join(roads, " → ")}
		if mode == "driving" {
			toll := n(p["tolls"])
			if !math.IsNaN(toll) {
				route.Tolls = &toll
			}
		}
		routes = append(routes, route)
	}
	if len(routes) == 0 {
		return Result{Status: "error", Reason: "高德返回的路线数据不完整，请重试"}
	}
	return Result{Status: "success", Alternatives: routes}
}
func parsePolyline(value string) []Point {
	points := []Point{}
	for _, pair := range strings.Split(value, ";") {
		p, err := ParsePoint(pair)
		if err != nil {
			return nil
		}
		points = append(points, p)
	}
	return points
}
func s(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case json.Number:
		return string(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	}
	return ""
}
func n(value any) float64 {
	v, err := strconv.ParseFloat(s(value), 64)
	if err != nil {
		return math.NaN()
	}
	return v
}
func o(value any) map[string]any { v, _ := value.(map[string]any); return v }
func a(value any) []any          { v, _ := value.([]any); return v }
func unique(values []string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, v := range values {
		if v != "" && !seen[v] {
			result = append(result, v)
			seen[v] = true
		}
	}
	return result
}
