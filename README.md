# 多目的地路线查询

原项目已迁移到 **Go + Gin + templ + htmx**。沿用顶部出发地页签、真实地图、目的地耗时表的布局。

## 技术栈

| 层次 | 实现 |
| --- | --- |
| HTTP 与业务 | Go 1.27、Gin 1.12.0，单体应用 |
| 服务端页面 | templ 0.3.1118，类型化组件，编译为 Go |
| 局部更新 | htmx 2.0.11，XMLHttpRequest，返回 HTML 片段 |
| 地图显示 | 高德 JS API 2.0 + 原生 JavaScript |
| 地点与算路 | Go `net/http` 调用高德 Web 服务 API |
| 状态 | 当前页面的服务端内存工作区，无数据库 |
| 打包部署 | 嵌入静态资源的 Go 二进制、Docker/Compose |

首次访问返回完整 HTML。后续搜索、编辑、删除、切换地点和备选路线均返回指定区域的 HTML 片段；地图节点和高德实例保持挂载。客户端只有地图绘制、弹窗、键盘与请求联动代码，React/Vite 版本已移除。

## 功能与边界

- 多个出发地页签，一次选中一个出发地，所有出发地共用目的地列表。
- 搜索真实地点、地图选点、显示名称、编辑删除与撤销。
- 驾车、公交·地铁、自行车、电动自行车、步行独立查询；自行车与电动车分别调用供应商接口。
- 驾车默认高德推荐，支持躲避拥堵、速度优先、少收费、不走高速（v3 策略 10/12/0/14/13）。
- 保留供应商实际返回的可用备选路线。选择方案后同步更新耗时、距离、地图路径与过路费。
- 保留高德原始秒数，显示分钟向上取整；不按固定速度自行估算，也不保证电动车一定比自行车快。
- 切换地点和偏好时取消旧查询、拒绝过期结果；请求限制并发与发送间隔。
- 地址、坐标、耗时与路径均来自真实服务；失败或无路线时明确显示，不以测试数据或直线替代。
- 百度和开源方案仍未接入。额度、权限、备选路线数量及覆盖范围由高德决定。

地点仅在当前页面的服务端工作区中保留，刷新即创建新工作区；进程重启会清空状态，暂不支持多实例间共享。闲置工作区在后续打开页面时回收。此版本没有新增账号、持久化、房源或家庭功能。

## 运行配置

Go 服务需要以下三个环境变量，示例文件不含任何真实值：

| 变量 | 用途 |
| --- | --- |
| `AMAP_JS_KEY` | Web 端 JS API Key，加载浏览器底图时使用的公开标识 |
| `AMAP_JS_SECURITY_CODE` | JS API 安全密钥，仅在服务端代理中附加 |
| `AMAP_WEB_SERVICE_KEY` | Web 服务类型 Key，用于地点搜索、逆地理编码和全部五种出行方式 |
| `LISTEN_ADDR` | 监听地址，原生程序默认 `:8080` |
| `GO_PROXY_TOKEN` | 可选；通过 Sites 网关访问时，在 Go 服务和网关配置相同的随机值 |

安全密钥和 Web 服务 Key 不返回浏览器，不写入源码或构建参数。`/api/maps/config` 只提供浏览器所需的 JS Key 与服务能力。`/_AMapService` 仅转发固定高德端点，不向高德转发站点 Cookie、Authorization 或网关凭据。

如配置高德白名单，应允许实际浏览器访问的域名。Web 服务 Key 的权限、额度与 IP 白名单也需要匹配实际服务器。

## 本地开发

安装 Go 1.27 或更高版本，设置以上环境变量，然后运行：

```sh
go tool templ generate
go run -tags nomsgpack ./cmd/server
```

默认访问 `http://localhost:8080`。也可以复制 `.env.example` 为仅本机使用的 `.env.local` 并填写配置，执行 `make dev`（默认 `http://localhost:4173`）。不要提交本地配置。

`scripts/go-tool.sh` 默认使用 PATH 中的 Go，也支持 `GO_BINARY` 指定已安装的 Go 可执行文件。所有依赖和 templ 命令版本均由 `go.mod` / `go.sum` 固定。生成的 `page_templ.go` 随源码提交，普通编译无需额外安装 templ CLI。

## 验证与打包

```sh
go test -race -p 2 -tags nomsgpack ./...
go vet -tags nomsgpack ./...
make build
```

产物 `bin/route-workbench` 已内嵌页面样式、htmx、图标与地图脚本，运行时不依赖 Node.js。`nomsgpack` 只跳过本项目未使用的 Gin MsgPack 支持。

测试使用明确的 mock 服务，覆盖模板片段、五模式多目的地查询、备选路线选择、删除撤销、旧查询取消、同会话刷新隔离、CSRF、输出转义与供应商数据解析。真实高德联调结果见 `design-qa.md`。

使用 Docker：

```sh
cp .env.example .env
# 编辑 .env，填入你自己的配置
docker compose up -d --build
```

Compose 默认只将端口映射到本机 `127.0.0.1:8080`，便于接入已有 HTTPS 反向代理。原生直连服务本身没有账号登录；公开部署时应保留已有访问控制。可用 `/healthz` 检查运行状态，配置 `GO_PROXY_TOKEN` 时健康检查也需要同名 `X-Route-Proxy-Token` 请求头。

## 当前上线状态

**源码迁移完成；现有线上 Site 尚未替换为 Go 服务。** 当前 ChatGPT Sites 托管执行 Workers ES module，不能直接运行此 Go 进程。本次保留上一版在线服务，避免在缺少 Go 主机时发布不可用页面。

可选的 `worker/index.js` 现在只是 Sites 到 Go 服务的转发网关，全部页面、业务和地图 API 均由 Go 执行。若要保留原 Sites 地址：

1. 将 Go 二进制或 Docker 容器部署到支持常驻 Go 服务的主机，并提供 HTTPS 地址。
2. Go 服务设置 `GO_PROXY_TOKEN`；Sites 设置固定 `GO_APP_ORIGIN` 和相同的 `GO_PROXY_TOKEN` 机密。
3. Go 主机设置三个高德变量；网关无需存储地图密钥。
4. 验证后再发布网关版本，保留原 Site 的访问范围。

未配置 Go 主机时网关会明确返回 503，**不要覆盖当前可用的线上版本**。也可以直接将 Go 服务部署到自有域名，无需 Sites 网关。

`package.json` 仅供当前托管环境启动预览和打包，不含前端依赖。`node --test tests/gateway.test.mjs` 只检查可选的网关。构建额外产生 `dist/server/index.js` 和托管清单用于保存 Sites 源码版本；`dist/native` 才是实际 Go 程序。

## 源码位置

- `cmd/server/main.go`：配置、HTTP 服务、优雅关闭。
- `internal/app`：Gin 路由、页面工作区、局部更新与高德 SDK 代理。
- `internal/maps`：高德 HTTP 客户端、五模式解析、原始耗时与路径分段。
- `internal/ui/page.templ`：页面与局部组件；`page_templ.go` 为生成代码。
- `web/assets/app.js`：单个高德地图实例、标记、路线与 htmx 联动。
- `web/embed.go`：静态文件嵌入。
- `Dockerfile` / `compose.yaml`：原生 Go 部署。
- `worker/index.js`：可选的 Sites 网关。
- `reference/selected-design.png`：已确认的视觉参考。
