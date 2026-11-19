package app

import (
	"errors"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/natefinch/atomic"
	"jicheng/internal/maps"
	"jicheng/internal/ui"
)

var mapEnvNames = [...]string{"AMAP_JS_KEY", "AMAP_JS_SECURITY_CODE", "AMAP_WEB_SERVICE_KEY"}
var mapKey = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var envAssignment = regexp.MustCompile(`(?m)^[\t ]*(?:export[\t ]+)?([A-Za-z_][A-Za-z0-9_]*)[\t ]*=[\t ]*("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[^\r\n]*)[^\r\n]*(?:\r?\n|$)`)

func LoadConfig(path string) (Config, error) {
	content, err := readEnv(path)
	if err != nil {
		return Config{}, err
	}
	keys := map[string]string{}
	for _, name := range mapEnvNames {
		keys[name] = os.Getenv(name)
	}
	for _, match := range envAssignment.FindAllStringSubmatch(strings.TrimPrefix(content, "\ufeff"), -1) {
		if _, ok := keys[match[1]]; !ok {
			continue
		}
		value, _, _ := strings.Cut(match[2], "#")
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if mapKey.MatchString(value) {
			keys[match[1]] = value
		}
	}
	return Config{JSKey: keys[mapEnvNames[0]], SecurityCode: keys[mapEnvNames[1]], WebKey: keys[mapEnvNames[2]], ProxyToken: os.Getenv("GO_PROXY_TOKEN")}, nil
}

func readEnv(path string) (string, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New(".env must be a regular file")
	}
	data, err := os.ReadFile(path)
	return string(data), err
}

func writeMapEnv(path string, keys [3]string) error {
	content, err := readEnv(path)
	if err != nil {
		return err
	}
	newline := "\n"
	if strings.Contains(content, "\r\n") {
		newline = "\r\n"
	}
	var updated strings.Builder
	if strings.HasPrefix(content, "\ufeff") {
		updated.WriteString("\ufeff")
		content = strings.TrimPrefix(content, "\ufeff")
	}
	offset := 0
	for _, match := range envAssignment.FindAllStringSubmatchIndex(content, -1) {
		name := content[match[2]:match[3]]
		if name == mapEnvNames[0] || name == mapEnvNames[1] || name == mapEnvNames[2] {
			updated.WriteString(content[offset:match[0]])
			offset = match[1]
		}
	}
	updated.WriteString(content[offset:])
	if retained := updated.String(); retained != "" && retained != "\ufeff" && !strings.HasSuffix(retained, "\n") {
		updated.WriteString(newline)
	}
	for index, name := range mapEnvNames {
		updated.WriteString(name + "=" + keys[index] + newline)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".env.tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err := file.WriteString(updated.String()); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return atomic.ReplaceFile(file.Name(), path)
}

func (a *App) canEditMap(request *http.Request) bool {
	if a.config.LocalEnvFile == "" || a.config.ProxyToken != "" || request.Header.Get("Forwarded") != "" || request.Header.Get("X-Forwarded-For") != "" || request.Header.Get("X-Forwarded-Host") != "" || request.Header.Get("X-Forwarded-Proto") != "" {
		return false
	}
	peer, _, _ := net.SplitHostPort(request.RemoteAddr)
	host, _, err := net.SplitHostPort(request.Host)
	if err != nil {
		host = strings.Trim(request.Host, "[]")
	}
	return net.ParseIP(peer).IsLoopback() && (net.ParseIP(host).IsLoopback() || strings.EqualFold(host, "localhost"))
}

func (a *App) saveMapSettings(c *gin.Context, w *workspace) {
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if !a.canEditMap(c.Request) || c.GetHeader("Origin") != scheme+"://"+c.Request.Host {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	keys := [3]string{strings.TrimSpace(c.PostForm("js_key")), strings.TrimSpace(c.PostForm("security_code")), strings.TrimSpace(c.PostForm("web_key"))}
	for _, key := range keys {
		if !mapKey.MatchString(key) {
			a.render(c, ui.MapSettingsFeedback("请填写三项密钥，每项只能包含字母、数字、连字符或下划线。", false))
			return
		}
	}
	a.mu.Lock()
	if err := writeMapEnv(a.config.LocalEnvFile, keys); err != nil {
		a.mu.Unlock()
		a.render(c, ui.MapSettingsFeedback("无法写入 .env，请检查当前目录和文件权限。", false))
		return
	}
	mapWasConfigured := a.config.JSKey != "" && a.config.SecurityCode != ""
	reload := mapWasConfigured && a.config.JSKey != keys[0]
	webChanged := a.config.WebKey != keys[2]
	if webChanged {
		a.provider = maps.NewClient(keys[2])
	}
	if !mapWasConfigured || webChanged {
		for _, page := range a.workspaces {
			page.mu.Lock()
			page.view.MapConfigured = true
			if webChanged {
				page.provider = a.provider
				page.view.WebConfigured = true
				page.searchSeq++
				invalidate(page)
			}
			page.mu.Unlock()
		}
	}
	a.config.JSKey, a.config.SecurityCode, a.config.WebKey = keys[0], keys[1], keys[2]
	w.mu.Lock()
	view := snapshot(w)
	w.mu.Unlock()
	a.mu.Unlock()
	c.Header("HX-Trigger-After-Settle", `{"route:map-configured":true,"route:updated":true}`)
	a.render(c, ui.MapSettingsSaved(view, reload))
}
