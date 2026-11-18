package maps

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

type Point [2]float64

func ParsePoint(value string) (Point, error) {
	parts := strings.Split(value, ",")
	if len(parts) != 2 {
		return Point{}, fmt.Errorf("地点坐标无效")
	}
	lng, e1 := strconv.ParseFloat(parts[0], 64)
	lat, e2 := strconv.ParseFloat(parts[1], 64)
	if e1 != nil || e2 != nil || math.IsNaN(lng) || math.IsNaN(lat) || math.IsInf(lng, 0) || math.IsInf(lat, 0) || math.Abs(lng) > 180 || math.Abs(lat) > 90 {
		return Point{}, fmt.Errorf("地点坐标无效")
	}
	return Point{lng, lat}, nil
}
func (p Point) String() string { return fmt.Sprintf("%.6f,%.6f", p[0], p[1]) }

type Place struct {
	ProviderID string `json:"providerId"`
	Name       string `json:"name"`
	Address    string `json:"address"`
	City       string `json:"city"`
	Point      Point  `json:"point"`
}
type Route struct {
	ID       string    `json:"id"`
	Index    int       `json:"index"`
	Minutes  int       `json:"minutes"`
	Seconds  float64   `json:"seconds"`
	Distance float64   `json:"distance"`
	Segments [][]Point `json:"segments"`
	Summary  string    `json:"summary"`
	Tolls    *float64  `json:"tolls,omitempty"`
}
type Result struct {
	Status       string  `json:"status"`
	Reason       string  `json:"reason,omitempty"`
	Code         string  `json:"code,omitempty"`
	SelectedID   string  `json:"selectedId,omitempty"`
	Alternatives []Route `json:"alternatives,omitempty"`
}

func (r Result) Selected() Route {
	for _, v := range r.Alternatives {
		if v.ID == r.SelectedID {
			return v
		}
	}
	if len(r.Alternatives) > 0 {
		return r.Alternatives[0]
	}
	return Route{}
}
func (r Result) Success() bool { return r.Status == "success" && len(r.Alternatives) > 0 }
func DistanceLabel(meters float64) string {
	if meters >= 1000 {
		return fmt.Sprintf("%.1f 公里", meters/1000)
	}
	return fmt.Sprintf("%.0f 米", meters)
}
func Pending() Result { return Result{Status: "pending"} }
func Failure(code string) Result {
	messages := map[string]string{"INVALID_USER_KEY": "高德 Key 无效，请检查配置", "USERKEY_PLAT_NOMATCH": "高德 Key 类型不匹配", "INVALID_USER_SCODE": "高德安全校验未通过", "INVALID_USER_DOMAIN": "当前域名未获高德授权", "USER_DAILY_QUERY_OVER_LIMIT": "今日高德调用额度已用完", "DAILY_QUERY_OVER_LIMIT": "今日高德调用额度已用完", "CUQPS_HAS_EXCEEDED_THE_LIMIT": "查询过于频繁，请稍后重试", "TIMEOUT": "查询超时，请重试", "INSUFFICIENT_PRIVILEGES": "当前 Key 未开通此高德服务", "USERKEY_RECYCLED": "高德 Key 已被注销"}
	reason := messages[code]
	if reason == "" {
		reason = "高德查询失败，请稍后重试"
	}
	return Result{Status: "error", Reason: reason, Code: code}
}
