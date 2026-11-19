# 几程快速启动

本包为 **Go + Gin + templ + htmx** 版本。解压后进入 `jicheng` 目录。

## 完整包内容

| 位置 | 内容 |
| --- | --- |
| `cmd`、`internal`、`web` | 全部 Go 源码、templ 源文件和生成代码、浏览器资源 |
| `go.mod`、`go.sum` | 固定版本的 Go 依赖声明与校验信息 |
| `scripts`、`Makefile` | 开发、生成、构建和跨平台编译脚本 |
| `Dockerfile`、`compose.yaml` | Docker 部署配置 |
| `.env.example` | 高德配置模板，不含真实密钥 |
| `release/windows-amd64/jicheng.exe` | Windows x64 可执行文件 |
| `release/linux-amd64/jicheng` | Linux x64 可执行文件 |
| `README.md` | 功能、配置、开发与部署说明 |
| `design-qa.md` | 验证记录与部署状态 |
| `reference` | 视觉参考、界面验证截图 |
| `THIRD_PARTY_NOTICES.md`、`licenses` | 随包依赖的许可证信息 |
| `PACKAGE-INFO.txt`、`SHA256SUMS` | 本次交付的源码版本及文件校验值 |

源码包与完整包的源码一致；单独的源码包不附 `release`、`licenses` 和交付清单。使用完整包中的可执行文件，无需安装 Go、Node.js 或 templ。真实地图需要联网访问高德服务。

## Windows x64 运行

在解压后的 `jicheng` 目录打开 PowerShell，将下面三个占位内容替换为自己的高德配置，再执行：

```powershell
$env:AMAP_JS_KEY = "填写 Web 端 JS API Key"
$env:AMAP_JS_SECURITY_CODE = "填写 JS API 配套安全密钥"
$env:AMAP_WEB_SERVICE_KEY = "填写 Web 服务 API Key"
$env:LISTEN_ADDR = "127.0.0.1:8080"
.\release\windows-amd64\jicheng.exe
```

浏览器访问 `http://localhost:8080`。保持窗口打开，按 `Ctrl+C` 停止。变量只对当前 PowerShell 及其启动的程序生效。

## Linux x64 运行

在解压后的 `jicheng` 目录执行：

```sh
export AMAP_JS_KEY='填写 Web 端 JS API Key'
export AMAP_JS_SECURITY_CODE='填写 JS API 配套安全密钥'
export AMAP_WEB_SERVICE_KEY='填写 Web 服务 API Key'
export LISTEN_ADDR='127.0.0.1:8080'
chmod +x release/linux-amd64/jicheng
./release/linux-amd64/jicheng
```

浏览器访问 `http://localhost:8080`。服务器部署可使用下面的 Docker 配置或已有的进程管理、HTTPS 反向代理。

## Docker 运行

复制 `.env.example` 为 `.env`，填好三个高德变量，然后执行：

```sh
docker compose up -d --build
```

默认映射到本机 `127.0.0.1:8080`。运行中的容器包含原生 Go 服务；构建阶段需要下载 Go 依赖和镜像。

## 从源码开发

安装 Go 1.26+，设置三个高德环境变量后执行：

```sh
go tool templ generate
go run -tags nomsgpack ./cmd/server
```

没有设置 `LISTEN_ADDR` 时，程序默认监听 `127.0.0.1:8080`。源码已经包含生成的 templ Go 文件，因此也可以直接 `go build`。首次构建需要联网下载 `go.mod` 中的依赖。

重新制作 Linux/Windows 可执行文件：在 Linux、macOS 或 Windows 的 Git Bash 中运行 `make release`，结果位于 `bin/linux-amd64` 和 `bin/windows-amd64`。Windows PowerShell 可直接交叉编译：

```powershell
$env:CGO_ENABLED = "0"
go build -tags nomsgpack -trimpath -o jicheng.exe ./cmd/server
```

## 操作流程

1. 在地图下方搜索地点，点选准确的搜索结果。也可以直接点击地图。
2. 在地点详情中点击“设为起点”或“设为终点”。可先添加任意一类地点。
3. 重复以上操作，添加多个起点和多个终点；新起点自动成为当前起点。
4. 左侧面板中切换起点，全部终点的路线与五种交通方式耗时自动更新。
5. 点击某个终点的交通方式或耗时，查看备选路线；点击“返回全部终点”回到对比。
6. 可收起面板查看大地图，点击“路线与耗时”重新展开。

各个终点独立规划，不表示依次途经。

## 使用提示

- 三种高德配置的类型要对应；Web 服务 Key 不能使用 JS Key 代替。
- 使用 JS Key 域名白名单时，需允许实际访问域名；Web 服务 Key 的 IP 白名单需匹配实际服务器。
- 本机直连时，可在右上角的「高德地图」配置中保存密钥到当前工作目录的 `.env`。原生程序从该文件读取高德配置，未填写的项回退到环境变量。Docker Compose 仍通过 `env_file` 加载 `.env`，不接受网页写入。
- 地点保留在当前页面会话，刷新或重启程序后清空。
- 此次交付是地图主界面的 Go 版。已有线上 Site 仍为此前版本；上线 Go 版需要支持 Go/Docker 的主机。
