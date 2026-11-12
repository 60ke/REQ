# macOS / Windows 开发预览包

GitHub Actions 自动构建 Windows x64、macOS Apple Silicon 和 Intel Mac 开发预览安装包。
构建结果以每次运行页面为准；CI 不包含安装或桌面界面启动验证。

## 如何运行

1. 经授权后，把本项目内容放到 GitHub 仓库根目录。不要提交 `node_modules`、`dist` 或 `src-tauri/target`。
2. 将 `.github/workflows/build-desktop.yml` 放在仓库默认分支。推送到 `main`、面向 `main` 的 Pull Request 会自动触发构建；也支持手动触发。不会创建 Release 或推送提交。
3. 打开 **Actions → Build desktop previews → Run workflow**，选择经过审核的分支。
4. 等待准备任务和三个平台任务成功，在该次运行页面的 **Artifacts** 下载对应压缩包。每个平台独立构建，失败的平台不会上传不完整安装包。

输出：

- `req-macos-arm64-preview-…`：Apple Silicon 的 `.dmg` 和保留应用权限/资源的 `.app.zip`。
- `req-macos-x64-preview-…`：Intel Mac 的 `.dmg` 和 `.app.zip`。
- `req-windows-x64-preview-…`：64 位 Windows 的 NSIS `.exe` 和 MSI `.msi` 安装程序。
- `req-cargo-lock-…`：本次所有平台共享的 `Cargo.lock`。

每个安装包压缩包还包含 `Cargo.lock`、`package-lock.json`、`BUILD-METADATA.json`、`SHA256SUMS.txt` 和使用限制说明。Artifacts 默认保留 30 天，请及时下载。私有仓库运行可能消耗账户的 Actions 配额，具体取决于账户设置。

## 依赖与复现

- Node.js 固定为 `24.22.1`，Rust 固定为 `1.99.0`。前端通过 `npm ci` 使用已有锁文件；工作流引用的 GitHub Actions 固定到已核实的提交 SHA。
- 如果仓库尚无 `src-tauri/Cargo.lock`，准备任务会生成一次，上传后供三个平台共同使用。**这次初始解析在不同运行之间仍可能得到不同版本**，不能声称依赖已经完全固定。
- 核验首次构建后，将下载的 `Cargo.lock` 放回 `src-tauri/` 并审核提交。后续测试与构建使用 `--locked`，不会静默改写锁文件。
- 要重现旧产物，使用元数据里的源码 commit、工具链版本，以及该产物附带的两个锁文件。GitHub 托管 runner、SDK 和系统工具仍会更新，因此不保证逐字节一致。
- 使用固定的 `macos-15`、`macos-15-intel` 和 `windows-2022` 标签，分别原生构建 ARM Mac、Intel Mac 和 Windows x64。没有跨平台假冒产物，也没有 Windows ARM 构建。

## 签名与安全限制

- **macOS 只有本地 ad-hoc 签名**，不是 Apple Developer ID 签名，也没有经过 Apple 公证。没有配置 Apple 账号或证书。Gatekeeper 仍可能显示警告或阻止打开。
- **Windows 安装包未签名**，没有 Authenticode 证书。SmartScreen 或安全软件可能提示未知发布者或阻止运行。
- 不应把这些产物描述为已认证、已公证、正式发行或生产可用。工作流不会关闭系统保护，也不会自动修改用户安全设置。
- 安装前核对来源和校验和，并先使用无敏感数据的测试环境。原生核心测试与打包成功不等于应用 GUI 已通过实际启动测试。
- `assets/req-placeholder.svg` 及生成图标只是临时、中性的打包占位资源，不代表最终品牌设计。

## 本地检查

```sh
npm ci
npm test
npm run build
node --test scripts/ci/collect-artifacts.test.mjs
```

安装对应平台的 [Tauri 开发依赖](https://v2.tauri.app/start/prerequisites/) 和固定 Rust 工具链后，可以运行：

```sh
rustup toolchain install 1.99.0 --profile minimal
# 首次缺少锁文件时：
cargo +1.99.0 generate-lockfile --manifest-path src-tauri/Cargo.toml
cargo +1.99.0 test --locked --manifest-path src-tauri/Cargo.toml --lib
```

构建命令和产物整理规则以工作流为准。macOS 的 `.app` 需要用 `ditto` 归档，不能直接把原始 `.app` 目录交给 upload-artifact，否则可执行权限可能丢失。整理脚本会验证所需安装包齐全后才上传，并生成 SHA-256 校验和。

## 依据

- [GitHub 官方 runner 标签与架构](https://github.com/actions/runner-images/blob/main/README.md)
- [Tauri macOS 签名说明，包括 ad-hoc 签名限制](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri 分发文档](https://v2.tauri.app/distribute/)
- [Rust 1.99.0 官方发布](https://github.com/rust-lang/rust/releases/tag/1.99.0)
