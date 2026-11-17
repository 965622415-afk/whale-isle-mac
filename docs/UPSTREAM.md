# 来源与派生说明

鲸屿 / Whale Isle 是 `965622415-afk/whale-isle-mac` 中维护的独立 macOS 派生项目。

- 上游：<https://github.com/Banan1cee/whale_girl>
- 本轮起点：`ca5ad645b71460ee9c17171ecee3f8be673f68d1`（上游 4.1.7）
- 新应用名称：鲸屿 · AI 配置中心 / Whale Isle
- macOS bundle ID：`io.whaleisle.config`
- 许可证：AGPL-3.0-only，完整文本见仓库根目录 LICENSE。

## 复用

模型客户端、人设与提示词组装、对话流程、会话记忆、日志脱敏和备份机制继续基于上游代码。上游贡献者与资源署名保留在 Git 历史及 NOTICE.md 中。

## 新增

`desktop/` 是新写的 macOS 桌面宿主与界面，包含模型连接与代理管理、密钥加密、模块化提示词、预设管理、本机试聊及打包。应用图标为本派生项目独立绘制。

## 不在当前 Mac 发行包中

Windows WPF 启动器、Windows 安装器、微信 Python 桥接和其第三方自动化依赖。仓库保留这些原始源码与历史文档仅用于来源追溯，并不代表 Mac 版支持它们。

本仓库改动只提交到当前用户的派生仓库，不修改原作者仓库，不向上游自动发起 PR。
