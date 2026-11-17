# 鲸屿 macOS 开发与交付

## 范围

4.2.0 是独立的 macOS 配置与本机试聊版本，不包含微信接入。桌面入口为 `desktop/main.js`；原有 Windows 启动器不参与本版构建。

## 架构

- Electron 主进程通过显式 IPC 操作白名单管理模型、角色、提示词、预设、试聊与记忆。
- renderer 仅加载本地文件，开启 sandbox、contextIsolation，关闭 nodeIntegration。没有通用文件执行或任意网络 IPC。
- 复用 `src/app.js` 注入的 Node 内核以及 `src/llm/client.js` 的模型参数、错误和 SSE 解析。Mac 宿主替换该实例的网络传输为 Electron net，以支持每个模型的独立代理设置。
- 不启动 HTTP 控制台或 Windows 桥接，不加载外部插件，不启动自动发送、日记、朋友圈与位置探测任务。
- 运行数据保存在 Electron userData 中，app 包内只有代码和静态资源。
- 通过 Electron safeStorage 的异步接口加密密钥，不写入内核明文设置文件。只在主进程内存中把当前密钥交给模型客户端。

## 构建

要求：macOS、Node 22.16 或更新版本、Xcode Command Line Tools。

```bash
npm --prefix desktop ci
npm --prefix desktop test
npm --prefix desktop run package
```

`desktop/scripts/package.js` 使用固定版本 Electron，构建 arm64 app。若 `artifacts/electron` 中已有对应官方 ZIP，会先核对 SHA256 再使用；否则打包工具从官方源下载。网络需要代理时，为下载工具配置 `HTTP_PROXY`、`HTTPS_PROXY` 与 `ELECTRON_GET_USE_PROXY=1`。

构建仅复制内核、assets、配置模板、许可证和明确列出的桌面文件。不包含 Windows EXE、桥接、测试数据、API 密钥或 node_modules。输出位于 `artifacts/mac/Whale Isle-darwin-arm64/Whale Isle.app`。

图标由 `desktop/scripts/make-icon.swift` 生成，安装包使用 ad-hoc 签名。不修改 SIP、Gatekeeper 或系统网络配置。

生成 DMG：

```bash
mkdir -p artifacts/dmg
cp -R 'artifacts/mac/Whale Isle-darwin-arm64/Whale Isle.app' artifacts/dmg/
ln -s /Applications artifacts/dmg/Applications
hdiutil create -volname 'Whale Isle' -srcfolder artifacts/dmg -ov -format UDZO 'artifacts/Whale-Isle-4.2.0-arm64.dmg'
```

## 验证

```bash
npm --prefix desktop test
node scripts/check-layers.js
node scripts/release-check.js
node scripts/privacy-scan.js .
```

Electron 集成冒烟使用 `desktop/test/smoke.js`，以隔离数据目录和本机 HTTP fixture 验证真实网络调用、SSE、预设、记忆、preload 与 IPC。它不使用用户 API 密钥，不声称验证了外部服务账号权限。

开发期从仓库根目录启动 Electron：

```bash
/path/to/Electron.app/Contents/MacOS/Electron desktop \
  --test-data=/absolute/temporary/isle-data \
  --smoke-output=/absolute/temporary/isle-result.json
```

`--test-data` 与 `--smoke-output` 仅供开发源码入口使用，正式 app 不包含 smoke 脚本。打包后应检查应用首页、模型编辑、人设保存、预设、演示试聊、诊断以及退出重启。

## 后续扩展

微信接入需独立设计和验证。不要把 Windows UIA 或数据库方案未经验证地标注为支持 Mac，也不要在没有授权时读取微信或发送测试消息。
