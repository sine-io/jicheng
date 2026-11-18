package app

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"routeworkbench/internal/maps"
	"routeworkbench/internal/ui"
)

var allTargets = []string{"origins", "search", "preferences", "results", "route-options", "modal", "picker-banner", "notice"}

func (a *App) action(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	if err := c.Request.ParseForm(); err != nil {
		c.AbortWithStatus(400)
		return
	}
	w := a.resolve(c, true)
	if w == nil {
		return
	}
	action := c.Param("action")
	if action == "query" {
		a.query(c, w)
		return
	}
	if action == "search-editor" || action == "submit" {
		a.search(c, w, action == "search-editor")
		return
	}
	if action == "pick" {
		a.pick(c, w)
		return
	}
	targets := allTargets
	w.mu.Lock()
	w.view.Toast = ""
	switch action {
	case "open-editor":
		kind := c.PostForm("kind")
		if !validKind(kind) {
			w.mu.Unlock()
			c.AbortWithStatus(400)
			return
		}
		places := w.view.Origins
		if kind == "destination" {
			places = w.view.Destinations
		}
		p, index := placeByID(places, c.PostForm("id"))
		e := &ui.Editor{Kind: kind}
		if index >= 0 {
			selected := p.Place
			e.ID = p.ID
			e.Name = p.Name
			e.Selected = &selected
		}
		w.view.Editor = e
		w.view.Picking = false
		targets = []string{"modal", "picker-banner", "notice"}
	case "close-editor":
		w.view.Editor = nil
		targets = []string{"modal"}
	case "select-place":
		if w.view.Editor != nil {
			e := w.view.Editor
			e.Name = formValue(c, "name", 32)
			index, err := strconv.Atoi(c.PostForm("choice"))
			if err == nil && index >= 0 && index < len(e.Choices) {
				selected := e.Choices[index]
				e.Selected = &selected
				e.Error = ""
			}
		}
		targets = []string{"modal", "notice"}
	case "save-place":
		if w.view.Editor != nil {
			e := w.view.Editor
			e.Name = formValue(c, "name", 32)
			if e.Selected == nil {
				e.Error = "请从搜索结果中选择地点，或在地图上选点"
				targets = []string{"modal"}
			} else {
				savePlace(w, e.Kind, e.ID, e.Name, *e.Selected)
				w.view.Editor = nil
				w.view.Toast = "地点已保存"
			}
		}
	case "activate-origin":
		if _, index := placeByID(w.view.Origins, c.PostForm("id")); index >= 0 {
			w.view.ActiveID = c.PostForm("id")
			w.view.Query = w.view.Active().Name
			w.view.SearchOpen = false
			w.view.Picking = false
			invalidate(w)
		}
	case "delete-place":
		kind := c.PostForm("kind")
		places := &w.view.Origins
		if kind == "destination" {
			places = &w.view.Destinations
		}
		if !validKind(kind) {
			w.mu.Unlock()
			c.AbortWithStatus(400)
			return
		}
		p, index := placeByID(*places, c.PostForm("id"))
		if index >= 0 {
			w.undo = &removed{Kind: kind, Place: p, Index: index}
			*places = append((*places)[:index], (*places)[index+1:]...)
			if kind == "origin" && w.view.ActiveID == p.ID {
				w.view.ActiveID = ""
				w.view.Query = ""
				if len(w.view.Origins) > 0 {
					w.view.ActiveID = w.view.Origins[0].ID
					w.view.Query = w.view.Origins[0].Name
				}
			}
			invalidate(w)
			w.view.Toast = "已删除 " + p.Name
		}
	case "undo":
		if w.undo != nil {
			r := *w.undo
			places := &w.view.Origins
			if r.Kind == "destination" {
				places = &w.view.Destinations
			}
			index := r.Index
			if index > len(*places) {
				index = len(*places)
			}
			*places = append(*places, ui.Place{})
			copy((*places)[index+1:], (*places)[index:])
			(*places)[index] = r.Place
			if r.Kind == "origin" {
				w.view.ActiveID = r.Place.ID
				w.view.Query = r.Place.Name
			}
			w.undo = nil
			invalidate(w)
			w.view.Toast = "已撤销删除"
		}
	case "select-origin":
		index, err := strconv.Atoi(c.PostForm("choice"))
		if err == nil && index >= 0 && index < len(w.view.Search) {
			p := w.view.Search[index]
			savePlace(w, "origin", w.view.ActiveID, p.Name, p)
			w.view.SearchOpen = false
		}
	case "close-search":
		w.view.SearchOpen = false
		targets = []string{"search"}
	case "policy":
		value, err := strconv.Atoi(c.PostForm("policy"))
		valid := false
		for _, p := range ui.Policies {
			if p.ID == value {
				valid = true
			}
		}
		if err == nil && valid {
			w.view.Policy = value
			invalidate(w)
		}
		targets = []string{"preferences", "results", "route-options", "notice"}
	case "select-mode":
		id, mode := c.PostForm("id"), c.PostForm("mode")
		result := w.view.Cell(id, mode)
		if result.Success() {
			for i := range w.view.Destinations {
				if w.view.Destinations[i].ID == id {
					w.view.Destinations[i].Mode = mode
				}
			}
			w.view.FocusID = id
			w.view.PanelID = id
			w.view.PanelMode = mode
		}
		targets = []string{"results", "route-options"}
	case "select-route":
		id, mode, routeID := c.PostForm("id"), c.PostForm("mode"), c.PostForm("route")
		result := w.view.Cell(id, mode)
		for _, route := range result.Alternatives {
			if route.ID == routeID {
				result.SelectedID = routeID
				w.view.Results[id][mode] = result
				w.view.FocusID = id
				w.view.PanelID = id
				w.view.PanelMode = mode
				break
			}
		}
		targets = []string{"results", "route-options"}
	case "close-options":
		w.view.PanelID = ""
		targets = []string{"route-options"}
	case "start-pick":
		w.view.Picking = true
		w.view.PickKind = "origin"
		w.view.PickQuick = c.PostForm("quick") == "true"
		if w.view.PickQuick {
			w.view.Editor = nil
		} else if w.view.Editor != nil {
			w.view.Editor.Name = formValue(c, "name", 32)
			w.view.PickKind = w.view.Editor.Kind
		}
		w.view.SearchOpen = false
		targets = []string{"modal", "search", "picker-banner", "notice"}
	case "cancel-pick":
		w.view.Picking = false
		targets = []string{"modal", "picker-banner", "notice"}
	case "dismiss-toast":
		w.view.Toast = ""
		w.undo = nil
		targets = []string{"notice"}
	default:
		w.mu.Unlock()
		c.AbortWithStatus(404)
		return
	}
	w.mu.Unlock()
	a.update(c, w, targets...)
}
func savePlace(w *workspace, kind, id, name string, selected maps.Place) {
	if name == "" {
		name = selected.Name
	}
	selected.Name = name
	p := ui.Place{Place: selected, ID: id, Mode: "driving"}
	places := &w.view.Origins
	if kind == "destination" {
		places = &w.view.Destinations
	}
	_, index := placeByID(*places, id)
	if index >= 0 {
		p.Color = (*places)[index].Color
		p.Mode = (*places)[index].Mode
		(*places)[index] = p
	} else {
		p.ID = token()[:16]
		p.Color = len(w.view.Destinations)
		*places = append(*places, p)
	}
	if kind == "origin" {
		w.view.ActiveID = p.ID
		w.view.Query = p.Name
	}
	invalidate(w)
}
func (a *App) search(c *gin.Context, w *workspace, editor bool) {
	w.mu.Lock()
	query := formValue(c, "query", 100)
	requestedEditor := w.view.Editor
	if editor {
		if w.view.Editor == nil {
			w.mu.Unlock()
			c.Status(204)
			return
		}
		w.view.Editor.Name = formValue(c, "name", 32)
		w.view.Editor.Query = query
	} else {
		w.view.Query = query
		if active := w.view.Active(); active != nil && (query == active.Name || query == "") {
			invalidate(w)
			w.mu.Unlock()
			a.update(c, w, allTargets...)
			return
		}
		w.view.SearchOpen = true
	}
	w.searchSeq++
	seq := w.searchSeq
	city := ""
	if active := w.view.Active(); active != nil {
		city = active.City
	}
	w.mu.Unlock()
	choices, err := a.provider.Search(c.Request.Context(), query, city)
	if c.Request.Context().Err() != nil {
		c.Status(204)
		return
	}
	w.mu.Lock()
	if w.searchSeq != seq || editor && w.view.Editor != requestedEditor {
		w.mu.Unlock()
		c.Status(204)
		return
	}
	if editor {
		if w.view.Editor != nil {
			w.view.Editor.Choices = choices
			w.view.Editor.Searched = true
			w.view.Editor.Error = ""
			if err != nil {
				w.view.Editor.Error = err.Error()
			}
		}
	} else {
		w.view.Search = choices
		w.view.Toast = ""
		if err != nil {
			w.view.Toast = err.Error()
		}
	}
	w.mu.Unlock()
	if editor {
		a.update(c, w, "modal", "notice")
	} else {
		a.update(c, w, "search", "notice")
	}
}
func (a *App) pick(c *gin.Context, w *workspace) {
	point, err := maps.ParsePoint(c.PostForm("point"))
	if err != nil {
		w.mu.Lock()
		setError(w, err)
		w.mu.Unlock()
		a.update(c, w, "notice")
		return
	}
	w.mu.Lock()
	if !w.view.Picking {
		w.mu.Unlock()
		c.Status(204)
		return
	}
	revision := w.revision
	quick := w.view.PickQuick
	editor := w.view.Editor
	w.mu.Unlock()
	selected, err := a.provider.Reverse(c.Request.Context(), point)
	if c.Request.Context().Err() != nil {
		c.Status(204)
		return
	}
	w.mu.Lock()
	if !w.view.Picking || w.revision != revision || w.view.Editor != editor {
		w.mu.Unlock()
		c.Status(204)
		return
	}
	if err != nil {
		setError(w, err)
	} else {
		w.view.Picking = false
		if quick {
			savePlace(w, "origin", w.view.ActiveID, selected.Name, selected)
		} else if w.view.Editor != nil {
			w.view.Editor.Selected = &selected
		}
	}
	w.mu.Unlock()
	a.update(c, w, allTargets...)
}
func (a *App) query(c *gin.Context, w *workspace) {
	w.mu.Lock()
	if !w.view.CanQuery() {
		w.mu.Unlock()
		c.Status(204)
		return
	}
	if w.cancel != nil {
		w.cancel()
	}
	ctx, cancel := context.WithCancel(c.Request.Context())
	w.cancel = cancel
	id := token()
	w.queryID = id
	revision := w.revision
	view := snapshot(w)
	w.mu.Unlock()
	defer cancel()
	origin := *view.Active()
	result := map[string]map[string]maps.Result{}
	var lock sync.Mutex
	var jobs sync.WaitGroup
	for _, destination := range view.Destinations {
		result[destination.ID] = map[string]maps.Result{}
	}
	for _, destination := range view.Destinations {
		for _, mode := range ui.Modes {
			jobs.Add(1)
			go func(destination ui.Place, mode ui.Mode) {
				defer jobs.Done()
				r := a.provider.Route(ctx, origin.Place, destination.Place, mode.ID, view.Policy)
				lock.Lock()
				result[destination.ID][mode.ID] = r
				lock.Unlock()
			}(destination, mode)
		}
	}
	jobs.Wait()
	w.mu.Lock()
	if ctx.Err() != nil || w.revision != revision || w.queryID != id {
		w.mu.Unlock()
		c.Status(204)
		return
	}
	w.view.Results = result
	w.view.Dirty = false
	w.view.QueriedAt = time.Now().In(time.FixedZone("CST", 8*3600)).Format("15:04:05")
	w.cancel = nil
	w.mu.Unlock()
	a.update(c, w, "results", "route-options", "notice")
}
