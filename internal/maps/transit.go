package maps

import "strings"

func normalizeTransit(route *Route, transit map[string]any) {
	route.WalkDistance = quantity(transit["walking_distance"])
	lines := []string{}
	rides := 0
	addLeg := func(kind string, data map[string]any) TransitLeg {
		leg := TransitLeg{Kind: kind, PathStart: len(route.Segments)}
		if seconds := durationSeconds(data); seconds != nil {
			value := minutes(*seconds)
			leg.Minutes = &value
		}
		for _, step := range a(data["steps"]) {
			route.addPath(o(step)["polyline"])
		}
		route.addPath(data["polyline"])
		leg.PathEnd = len(route.Segments)
		return leg
	}
	for _, value := range a(transit["segments"]) {
		segment := o(value)
		walking := o(segment["walking"])
		if len(walking) > 0 {
			leg := addLeg("walk", walking)
			distance := quantity(walking["distance"])
			if leg.PathStart != leg.PathEnd || leg.Minutes != nil && *leg.Minutes > 0 || distance != nil && *distance > 0 {
				route.Legs = append(route.Legs, leg)
			}
		}
		if buslines := a(o(segment["bus"])["buslines"]); len(buslines) > 0 {
			line := o(buslines[0])
			if len(line) > 0 {
				kind := "bus"
				if strings.Contains(s(line["type"]), "地铁") || strings.HasPrefix(s(line["name"]), "地铁") {
					kind = "metro"
				}
				leg := addLeg(kind, line)
				leg.Name = lineName(s(line["name"]))
				leg.From = s(o(line["departure_stop"])["name"])
				leg.To = s(o(line["arrival_stop"])["name"])
				leg.Entrance = s(o(segment["entrance"])["name"])
				leg.Exit = s(o(segment["exit"])["name"])
				for _, stop := range a(line["via_stops"]) {
					if name := s(o(stop)["name"]); name != "" {
						leg.Stops = append(leg.Stops, name)
					}
				}
				if count := quantity(line["via_num"]); count != nil && *count >= float64(len(leg.Stops)) {
					value := int(*count)
					leg.ViaCount = &value
				} else if len(leg.Stops) > 0 {
					value := len(leg.Stops)
					leg.ViaCount = &value
				}
				route.Legs = append(route.Legs, leg)
				lines = append(lines, leg.Name)
				rides++
			}
		}
		if railway := o(segment["railway"]); len(railway) > 0 {
			leg := addLeg("rail", railway)
			leg.Name = s(railway["name"])
			leg.From = s(o(railway["departure_stop"])["name"])
			leg.To = s(o(railway["arrival_stop"])["name"])
			route.Legs = append(route.Legs, leg)
			lines = append(lines, leg.Name)
			rides++
		}
		if taxi := o(segment["taxi"]); len(taxi) > 0 {
			leg := addLeg("taxi", taxi)
			leg.Name = "出租车"
			route.Legs = append(route.Legs, leg)
			lines = append(lines, leg.Name)
			rides++
		}
	}
	if rides > 0 {
		value := rides - 1
		route.Transfers = &value
	}
	route.Summary = strings.Join(lines, " → ")
}

func lineName(name string) string {
	if index := strings.IndexAny(name, "(（"); index > 0 {
		return strings.TrimSpace(name[:index])
	}
	return name
}
