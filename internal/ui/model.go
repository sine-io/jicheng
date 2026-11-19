package ui

import (
	"encoding/json"
	"fmt"
	"jicheng/internal/maps"
)

type Mode struct{ ID, Name, Icon string }

var Modes = []Mode{{"driving", "驾车", "Car"}, {"transit", "公交·地铁", "Bus"}, {"cycling", "自行车", "Bicycle"}, {"electric", "电动车", "Bicycle"}, {"walking", "步行", "PersonSimpleWalk"}}

type Policy struct {
	ID   int
	Name string
}

var drivingPolicies = []Policy{{10, "高德推荐"}, {12, "躲避拥堵"}, {0, "速度优先"}, {14, "少收费"}, {13, "不走高速"}}
var transitPolicies = []Policy{{0, "高德推荐"}, {7, "地铁优先"}, {3, "步行少"}, {2, "换乘少"}, {8, "时间短"}, {5, "不乘地铁"}}
var Colors = []string{"#1680ff", "#ff8914", "#29b538", "#9867d8", "#e05c83", "#0a9f99", "#a47529", "#4668d2"}

type Place struct {
	maps.Place
	ID    string `json:"id"`
	Color int    `json:"color"`
	Mode  string `json:"mode"`
}

func (p Place) ColorValue() string { return Colors[p.Color%len(Colors)] }

type Editor struct {
	Kind, ID, Name, Query string
	Selected              *maps.Place
	Choices               []maps.Place
	Searched              bool
	Error                 string
}

func (e Editor) KindName() string {
	if e.Kind == "origin" {
		return "起点"
	}
	return "终点"
}
func (e Editor) Title() string {
	prefix := "添加"
	if e.ID != "" {
		prefix = "编辑"
	}
	return prefix + e.KindName()
}

type View struct {
	Workspace, CSRF              string
	Origins, Destinations        []Place
	ActiveID, Query              string
	Search                       []maps.Place
	SearchOpen                   bool
	Preview                      *maps.Place
	SearchError                  string
	Results                      map[string]map[string]maps.Result
	DrivingPolicy, TransitPolicy int
	Dirty                        bool
	FocusID, PanelID, PanelMode  string
	Editor                       *Editor
	Picking, PickQuick           bool
	PickKind                     string
	Toast                        string
	CanUndo                      bool
	QueriedAt                    string
	MapConfigured, WebConfigured bool
}

func (v View) Active() *Place {
	for _, p := range v.Origins {
		if p.ID == v.ActiveID {
			return &p
		}
	}
	return nil
}
func (v View) Cell(id, mode string) maps.Result {
	if row := v.Results[id]; row != nil {
		if result, ok := row[mode]; ok {
			return result
		}
	}
	if v.Active() != nil && v.Dirty {
		return maps.Pending()
	}
	return maps.Result{Status: "empty"}
}
func (v View) CanQuery() bool { return v.Active() != nil && len(v.Destinations) > 0 && v.WebConfigured }
func PoliciesFor(mode string) []Policy {
	switch mode {
	case "driving":
		return drivingPolicies
	case "transit":
		return transitPolicies
	}
	return nil
}
func (v View) ModePolicy(mode string) int {
	if mode == "driving" {
		return v.DrivingPolicy
	}
	if mode == "transit" {
		return v.TransitPolicy
	}
	return 0
}
func CanInspectMode(mode string, result maps.Result) bool {
	return result.Success() || len(PoliciesFor(mode)) > 0 && (result.Status == "no-route" || result.Status == "error")
}
func (v View) PanelPlace() *Place {
	for _, p := range v.Destinations {
		if p.ID == v.PanelID {
			return &p
		}
	}
	return nil
}
func (v View) PanelResult() maps.Result { return v.Cell(v.PanelID, v.PanelMode) }
func (v View) PanelModeValue() Mode {
	for _, m := range Modes {
		if m.ID == v.PanelMode {
			return m
		}
	}
	return Modes[0]
}
func Letter(index int) string {
	text := ""
	for n := index + 1; n > 0; n = (n - 1) / 26 {
		text = string(rune(65+(n-1)%26)) + text
	}
	return text
}
func Values(pairs ...string) string {
	values := map[string]string{}
	for i := 0; i+1 < len(pairs); i += 2 {
		values[pairs[i]] = pairs[i+1]
	}
	b, _ := json.Marshal(values)
	return string(b)
}
func Number(value int) string { return fmt.Sprint(value) }
func TimeLabel(result maps.Result) string {
	switch result.Status {
	case "pending":
		return "···"
	case "success":
		return fmt.Sprintf("%d 分钟", result.Selected().Minutes)
	case "no-route":
		return "暂无路线"
	case "error":
		return "查询失败"
	}
	return "—"
}
func CellClass(selected bool, result maps.Result) string {
	value := "time-cell"
	if selected && result.Success() {
		value += " selected"
	}
	if result.Status == "pending" {
		value += " pending"
	}
	if result.Status == "error" {
		value += " route-error"
	}
	return value
}
func CellTitle(result maps.Result) string {
	if result.Success() {
		return maps.DistanceLabel(result.Selected().Distance) + " · 点击选择路线"
	}
	return result.Reason
}
func RouteSelected(result maps.Result, id string) bool {
	return result.Success() && result.Selected().ID == id
}

func TransitLegTitle(route maps.Route, index int, destination string) string {
	leg := route.Legs[index]
	if leg.Kind == "walk" {
		if index+1 == len(route.Legs) {
			return "步行至" + destination
		}
		next := route.Legs[index+1]
		if next.From != "" {
			label := "步行至"
			if index > 0 && route.Legs[index-1].Kind != "walk" {
				label = "换乘步行至"
			}
			if next.Entrance != "" {
				return label + next.From + " · " + next.Entrance
			}
			return label + next.From
		}
		return "步行"
	}
	return TransitLineName(leg)
}

func TransitLineName(leg maps.TransitLeg) string {
	if leg.Name != "" {
		return leg.Name
	}
	switch leg.Kind {
	case "metro":
		return "地铁"
	case "rail":
		return "铁路"
	case "taxi":
		return "出租车"
	}
	return "公交"
}

func pickLabel(v View) string {
	if v.PickKind == "" {
		return "点击地图选择地点，再设为起点或终点"
	}
	if v.PickKind == "origin" {
		return "点击地图，设置出发地"
	}
	return "点击地图，设置目的地"
}
