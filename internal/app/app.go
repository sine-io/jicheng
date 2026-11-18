package app

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/a-h/templ"
	"github.com/gin-gonic/gin"
	"routeworkbench/internal/maps"
	"routeworkbench/internal/ui"
	"routeworkbench/web"
)

type Provider interface {
	Search(context.Context, string, string) ([]maps.Place, error)
	Reverse(context.Context, maps.Point) (maps.Place, error)
	Route(context.Context, maps.Place, maps.Place, string, int) maps.Result
}
type Config struct{ JSKey, SecurityCode, WebKey, ProxyToken string }
type removed struct {
	Kind  string
	Place ui.Place
	Index int
}
type workspace struct {
	mu        sync.Mutex
	owner     string
	view      ui.View
	revision  uint64
	searchSeq uint64
	cancel    context.CancelFunc
	queryID   string
	updated   time.Time
	undo      *removed
}
type App struct {
	config     Config
	provider   Provider
	mu         sync.Mutex
	workspaces map[string]*workspace
	handler    http.Handler
}

func New(config Config, provider Provider) *App {
	if provider == nil {
		provider = maps.NewClient(config.WebKey)
	}
	a := &App{config: config, provider: provider, workspaces: map[string]*workspace{}}
	a.routes()
	return a
}
func (a *App) Handler() http.Handler { return a.handler }
func token() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic("secure random source unavailable")
	}
	return hex.EncodeToString(b)
}
func (a *App) routes() {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	_ = router.SetTrustedProxies(nil)
	router.Use(func(c *gin.Context) {
		defer func() {
			if recover() != nil {
				slog.Error("request failed", "route", c.FullPath())
				c.AbortWithStatus(http.StatusInternalServerError)
			}
		}()
		c.Next()
	})
	router.Use(func(c *gin.Context) {
		if a.config.ProxyToken != "" && subtle.ConstantTimeCompare([]byte(c.GetHeader("X-Route-Proxy-Token")), []byte(a.config.ProxyToken)) != 1 {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Next()
	})
	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "runtime": "go", "framework": "gin", "templates": "templ", "updates": "htmx-xhr"})
	})
	assets, _ := fs.Sub(web.Assets, "assets")
	router.GET("/assets/*path", gin.WrapH(http.StripPrefix("/assets/", http.FileServer(http.FS(assets)))))
	router.GET("/", a.page)
	router.POST("/ui/:action", a.action)
	router.GET("/api/map-state", a.mapState)
	router.GET("/api/maps/config", func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		if a.config.JSKey == "" || a.config.SecurityCode == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "MAP_NOT_CONFIGURED"})
			return
		}
		c.JSON(200, gin.H{"provider": "amap", "jsKey": a.config.JSKey, "electricBikeEnabled": a.config.WebKey != ""})
	})
	router.GET("/_AMapService/*path", a.proxy)
	a.handler = router
}
func (a *App) page(c *gin.Context) {
	session, err := c.Cookie("route_session")
	if err != nil || len(session) != 48 {
		session = token()
		secure := c.Request.TLS != nil || a.config.ProxyToken != "" && c.GetHeader("X-Forwarded-Proto") == "https"
		http.SetCookie(c.Writer, &http.Cookie{Name: "route_session", Value: session, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
	}
	id := token()
	view := ui.View{Workspace: id, CSRF: token(), Origins: []ui.Place{}, Destinations: []ui.Place{}, Policy: 10, Results: map[string]map[string]maps.Result{}, MapConfigured: a.config.JSKey != "" && a.config.SecurityCode != "", WebConfigured: a.config.WebKey != ""}
	w := &workspace{owner: session, view: view, updated: time.Now()}
	a.mu.Lock()
	for key, old := range a.workspaces {
		old.mu.Lock()
		expired := time.Since(old.updated) > 2*time.Hour
		old.mu.Unlock()
		if expired {
			delete(a.workspaces, key)
		}
	}
	a.workspaces[id] = w
	a.mu.Unlock()
	c.Header("Cache-Control", "private, no-store")
	a.render(c, ui.Page(view))
}
func (a *App) resolve(c *gin.Context, write bool) *workspace {
	id := c.Query("workspace")
	if write {
		id = c.PostForm("workspace")
	}
	session, _ := c.Cookie("route_session")
	a.mu.Lock()
	w := a.workspaces[id]
	a.mu.Unlock()
	if w == nil || session == "" || w.owner != session {
		c.AbortWithStatus(403)
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if write {
		origin := c.GetHeader("Origin")
		expected := c.Request.Host
		if a.config.ProxyToken != "" && c.GetHeader("X-Forwarded-Host") != "" {
			expected = c.GetHeader("X-Forwarded-Host")
		}
		if origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Host != expected {
				c.AbortWithStatus(403)
				return nil
			}
		}
		if subtle.ConstantTimeCompare([]byte(c.PostForm("csrf")), []byte(w.view.CSRF)) != 1 {
			c.AbortWithStatus(403)
			return nil
		}
	}
	w.updated = time.Now()
	return w
}
func (a *App) render(c *gin.Context, component templ.Component) {
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "private, no-store")
	if err := component.Render(c.Request.Context(), c.Writer); err != nil {
		slog.Error("render failed", "route", c.FullPath())
	}
}
func snapshot(w *workspace) ui.View {
	v := w.view
	v.Origins = append([]ui.Place(nil), v.Origins...)
	v.Destinations = append([]ui.Place(nil), v.Destinations...)
	v.Search = append([]maps.Place(nil), v.Search...)
	v.Results = cloneResults(v.Results)
	if v.Editor != nil {
		e := *v.Editor
		e.Choices = append([]maps.Place(nil), e.Choices...)
		v.Editor = &e
	}
	v.CanUndo = w.undo != nil
	return v
}
func cloneResults(before map[string]map[string]maps.Result) map[string]map[string]maps.Result {
	result := map[string]map[string]maps.Result{}
	for id, row := range before {
		next := map[string]maps.Result{}
		for mode, value := range row {
			next[mode] = value
		}
		result[id] = next
	}
	return result
}
func (a *App) update(c *gin.Context, w *workspace, targets ...string) {
	w.mu.Lock()
	v := snapshot(w)
	w.mu.Unlock()
	c.Header("HX-Trigger-After-Swap", `{"route:updated":true}`)
	a.render(c, ui.Updates(v, targets))
}
func invalidate(w *workspace) {
	if w.cancel != nil {
		w.cancel()
		w.cancel = nil
	}
	w.queryID = ""
	w.revision++
	w.view.Results = map[string]map[string]maps.Result{}
	w.view.Dirty = w.view.CanQuery()
	w.view.FocusID = ""
	w.view.PanelID = ""
	w.view.QueriedAt = ""
}
func (a *App) mapState(c *gin.Context) {
	w := a.resolve(c, false)
	if w == nil {
		return
	}
	w.mu.Lock()
	v := snapshot(w)
	revision := w.revision
	w.mu.Unlock()
	type destination struct {
		ui.Place
		Letter string      `json:"letter"`
		Route  maps.Result `json:"route"`
	}
	destinations := []destination{}
	for i, p := range v.Destinations {
		destinations = append(destinations, destination{p, ui.Letter(i), v.Cell(p.ID, p.Mode)})
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(200, gin.H{"revision": revision, "origin": v.Active(), "destinations": destinations, "focusId": v.FocusID, "picking": v.Picking, "pickKind": v.PickKind, "configured": v.MapConfigured})
}

var servicePath = regexp.MustCompile(`^/(v3|v4|v5)/(place/(text|detail|around)|geocode/(geo|regeo)|direction/(driving|walking|bicycling|riding|transit/integrated))$`)
var callbackPattern = regexp.MustCompile(`^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$`)

func (a *App) proxy(c *gin.Context) {
	if a.config.JSKey == "" || a.config.SecurityCode == "" {
		c.AbortWithStatus(503)
		return
	}
	path := c.Param("path")
	styles := path == "/v4/map/styles"
	if !styles && !servicePath.MatchString(path) {
		c.AbortWithStatus(404)
		return
	}
	if len(c.Request.URL.RawQuery) > 16000 {
		c.AbortWithStatus(414)
		return
	}
	query := c.Request.URL.Query()
	callback := query.Get("callback")
	if query.Has("callback") && (!callbackPattern.MatchString(callback) || len(callback) > 128) {
		c.AbortWithStatus(400)
		return
	}
	query.Set("key", a.config.JSKey)
	query.Set("jscode", a.config.SecurityCode)
	base := "https://restapi.amap.com"
	if styles {
		base = "https://webapi.amap.com"
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, base+path+"?"+query.Encode(), nil)
	if err != nil {
		c.AbortWithStatus(502)
		return
	}
	scheme := "https"
	if c.Request.TLS == nil && a.config.ProxyToken == "" {
		scheme = "http"
	}
	host := c.Request.Host
	if a.config.ProxyToken != "" && c.GetHeader("X-Forwarded-Host") != "" {
		host = c.GetHeader("X-Forwarded-Host")
	}
	req.Header.Set("Referer", scheme+"://"+host+"/")
	client := http.Client{Timeout: 18 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		c.AbortWithStatus(502)
		return
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		c.AbortWithStatus(502)
		return
	}
	contentType := response.Header.Get("Content-Type")
	if callback != "" {
		contentType = "application/javascript; charset=utf-8"
	}
	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "private, no-store")
	c.Status(response.StatusCode)
	_, _ = io.Copy(c.Writer, io.LimitReader(response.Body, 12<<20))
}
func formValue(c *gin.Context, name string, max int) string {
	v := strings.TrimSpace(c.PostForm(name))
	if len([]rune(v)) > max {
		return string([]rune(v)[:max])
	}
	return v
}
func setError(w *workspace, err error) {
	if err != nil {
		w.view.Toast = err.Error()
	}
}
func validKind(kind string) bool { return kind == "origin" || kind == "destination" }
func placeByID(places []ui.Place, id string) (ui.Place, int) {
	for i, p := range places {
		if p.ID == id {
			return p, i
		}
	}
	return ui.Place{}, -1
}
