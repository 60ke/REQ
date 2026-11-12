# Req 0.1 开发预览版

本地优先的 API 请求工具。当前版本是开发预览，不需要账号或云服务，尚未完成原生桌面端验证，不建议用于生产敏感数据。

## 已实现
- HTTP 请求编辑、参数、请求头、文本/JSON/表单请求体、Bearer/Basic/API Key 认证。
- 环境变量、请求历史、保存和搜索；cURL 常见选项导入/导出；状态码、耗时、响应头和文本响应。
- Tauri/Rust 原生 HTTP 执行代码、超时、取消和安全限制。前端也有浏览器预览模式，但受 CORS 等浏览器限制，不等同桌面端。

## 启动与构建
需要 Node.js、Rust 以及对应系统的 [Tauri 2 开发依赖](https://v2.tauri.app/start/prerequisites/)。在目录下执行：

```bash
npm ci
npm run tauri dev
# 构建桌面安装包
npm run tauri build
```

前端测试与构建：`npm test`、`npm run build`。Rust 测试：`cargo test --manifest-path src-tauri/Cargo.toml`。原生端没有 Cargo.lock，首次构建需要解析和下载依赖。

## 当前限制与安全
- 本次只验证前端 39 项测试和生产构建；Rust 构建、桌面运行和真实浏览器端到端测试尚未执行。请先在测试环境验证。
- AI 未接入；脚本/断言、OAuth、文件上传、二进制响应下载、客户端证书、WebSocket、gRPC 等尚未完成。
- 密钥仅会话内保留，没有系统钥匙串集成；工作区文件没有加密。自动过滤不能识别所有正文或自定义字段中的秘密，不要保存敏感正文。导出的 cURL 可能包含密钥，应谨慎分享。
- cURL 解析不执行 shell，未支持选项会报错；跨域重定向默认不跟随，响应体有大小上限。取消不能撤销已到达服务器的操作。
- 详细网络、安全和功能范围见 `src-tauri/README.md`。

项目名称 Req 暂定。源码尚未选择开源许可证，也未发布到公共仓库。

## macOS / Windows 安装包构建

GitHub Actions 会在推送到 `main`、面向 `main` 的 Pull Request 时自动构建，也支持手动运行，覆盖 Apple Silicon、Intel Mac 和 Windows x64。在 [Actions](https://github.com/60ke/REQ/actions/workflows/build-desktop.yml) 的对应运行页面下载 Artifacts。它不会创建 Release；安装和桌面启动验证仍需单独完成。依赖锁定、下载步骤、临时图标以及未签名/未公证限制见 [桌面构建说明](docs/DESKTOP_BUILDS.md)。
