# 鲸屿群聊接入

如果这台 Mac 上已经运行 AstrBot，并且已有获准接入且能接收群消息和原生 @ 提及的机器人，可以用这个 AstrBot 插件把群聊接到 DSH 的鲸屿。企业微信群可使用企业微信智能机器人适配器。手机微信扫码创建的个人 ClawBot 用于私聊。

1. 打开 DSH 的鲸屿设置，启用群聊接入，添加要接入的群 ID，并复制接入密钥。
2. 把这里的 `astrbot_plugin_jingyu` 目录放到 AstrBot 的 `data/plugins/` 下。打开 AstrBot 的插件页，重载并启用「鲸屿群聊」。
3. 在 AstrBot 给插件填入同一把密钥和同一组群 ID。群 ID 可在对应群里用 AstrBot 的 `/sid` 查看。有多个机器人时，可以同时填入对应适配器 ID。
4. 在允许的群里使用聊天应用自己的 **@** 选中该机器人，然后输入「你好」。打开 DSH 里的群聊会话查看同一条消息和回复。

AstrBot 和 DSH 要能通过同一个本机回环地址 `127.0.0.1` 通讯。插件只转发允许群内明确 @ 自己的文字，单次等待最多 90 秒，失败时可以在 DSH 查看会话。处理并回复成功后，AstrBot 会结束这条消息的后续处理，避免内置 AI 再回复一次。

[AstrBot 消息事件](https://docs.astrbot.app/dev/star/guides/listen-message-event.html) · [AstrBot 插件配置](https://docs.astrbot.app/dev/star/guides/plugin-config.html) · [企业微信机器人接入](https://docs.astrbot.app/platform/wecom_ai_bot.html)
