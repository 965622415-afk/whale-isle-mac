# 参与鲸屿开发

鲸屿是面向 macOS 的独立派生版。当前工作范围为配置中心和本机试聊，不包含微信接入。请先阅读 [README](README.md)、[macOS 架构与构建](docs/MACOS.md) 和 [来源说明](docs/UPSTREAM.md)。

## 开发环境

- macOS、Node 22.16+、Xcode Command Line Tools。
- 在 `desktop/` 安装固定版本开发依赖：`npm --prefix desktop ci`。
- 启动：`npm --prefix desktop start`。
- 本地运行数据默认保存在 `~/Library/Application Support/Whale Isle/`，不要提交。

## 目录与边界

- `desktop/`：Mac UI、主进程、IPC、加密密钥管理、模型代理与打包。
- `src/`：上游内核，继续保持 CommonJS、零 npm 运行时依赖与既有分层。
- `docs/`：文档；`docs/upstream-workflows/` 保留上游 Windows 工作流作历史参考，不会在本仓库执行。
- `launcher/`、`bridge/`、`vendor/`：上游 Windows 实现，不在 Mac 包内。不要为 Mac 功能直接修改第三方文件。

## 提交和 PR

只向自己的派生仓库提交，使用功能分支和 PR，不向原作者自动推送。提交信息按“新增 / 改进 / 修复 / 其他”区分，省略没有内容的分类。

用户可见行为变化写进 `docs/CHANGELOG.md`。本 Mac 派生版本、根 package.json 和 desktop/package.json 的版本保持一致。

## 验证

```bash
npm --prefix desktop test
node scripts/check-layers.js
node scripts/release-check.js
node scripts/privacy-scan.js .
node tests/persona.test.js
node tests/prompt-layout.test.js
node tests/llm.test.js
node tests/memory-backup.test.js
npm --prefix desktop run package
```

真实外部模型测试需要用户自行配置密钥；自动化测试使用本机 fixture，不读取其他应用的凭据。严禁用演示模式证明真实连接成功。

任何导入内容只按数据处理，不授予代码执行能力。IPC 只接受本机应用页面和明确列出的操作。密钥不得回传界面、进入日志或包含在人设导出中。

## 许可证与署名

保留 LICENSE、上游署名、Git 历史与资源来源。鲸屿使用独立应用图标，继续遵循 AGPL-3.0-only。
