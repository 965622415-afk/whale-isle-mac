"use strict";
const workPages = {};
pages.splice(
  3,
  0,
  ["stickers", "▧", "表情包"],
  ["speech", "♫", "语音发送"],
  ["reminders", "♧", "主动与提醒"],
  ["moments", "◎", "朋友圈"],
  ["diary", "▥", "日记"],
  ["plugins", "⊞", "插件市场"],
);
pages.splice(
  pages.length - 1,
  0,
  ["settings", "⚙", "设置"],
  ["bridge", "⇄", "微信与 DSH"],
);
const groupNames = {
  chat: "对话",
  group: "群聊",
  care: "主动搭话",
  reminder: "提醒",
  diary: "日记",
  moments: "朋友圈",
  sticker: "表情包",
  memory: "记忆与预算",
  voice: "语音识别",
  links: "链接阅读",
  websearch: "联网搜索",
  env: "环境信息",
  storage: "媒体存储",
  log: "日志",
  features: "实验功能",
  vision: "看图模型",
};
const settingNames = {
  enabled: "启用",
  requireAt: "仅被 @ 时回复",
  freeChat: "参与群聊闲聊",
  freeChatChance: "闲聊概率",
  cooldownSec: "回复冷却 / 秒",
  maxRepliesPerMinute: "每分钟回复上限",
  silentMinutes: "安静时长 / 分钟",
  engagedMinutes: "连续聊天窗口 / 分钟",
  masterAlwaysReply: "始终回复主人",
  historyTurns: "私聊历史条数",
  groupHistoryTurns: "群聊历史条数",
  privateMaxChars: "私聊字数上限",
  groupMaxChars: "群聊字数上限",
  maxBubbles: "最多分段数",
  messageSettleMs: "连续消息收集 / 毫秒",
  groupMaxBatchWaitMs: "群聊最大等待 / 毫秒",
  temperature: "温度",
  onlyMaster: "只主动联系主人",
  allowGroups: "允许主动进群",
  allowOthers: "允许主动联系其他人",
  whitelist: "主动会话白名单（每行一项）",
  windows: "主动时间段（每行一项，如09:00-12:00）",
  everyMinutes: "间隔 / 分钟",
  jitterMinutes: "随机浮动 / 分钟",
  maxPerDay: "每日上限（0为不限）",
  quietAfterMinutes: "刚聊过后安静 / 分钟",
  provider: "服务商",
  baseUrl: "接口地址",
  model: "模型",
  timeoutMs: "超时 / 毫秒",
  maxSeconds: "最长语音 / 秒",
  cacheMinutes: "缓存 / 分钟",
  allowPrivate: "允许访问内网链接",
  semanticRoute: "模型判断是否需要联网",
  city: "搜索默认城市",
  timezone: "时区（例如 Asia/Shanghai）",
  location: "所在地（区县级）",
  time: "每天生成时间",
  sendToOwner: "生成后发送给主人",
  autoLike: "自动点赞",
  autoLikeMaxPerDay: "每天点赞上限",
  autoReadEveryHours: "读取朋友圈间隔 / 小时（0为手动）",
  publishFeatureEnabled: "发表功能总开关",
  publishEnabled: "定时发表",
  publishWithImage: "发表时配图",
  publishIntervalHours: "发表间隔 / 小时",
  publishMaxPerDay: "每日发表上限",
  demandChance: "提示模型配表情包的概率",
  ensureSend: "模型未标记时补配表情包",
  collectReceived: "收藏收到的表情包",
  dialogueBudget: "对话 Token 预算（不含人设）",
  maxMessages: "每个会话保留的原文条数",
  mediaKeepDays: "媒体保存天数",
  mediaMaxMB: "媒体上限 / MB",
  level: "控制台日志级别",
  fileLevel: "文件日志级别",
  trace: "记录诊断轨迹",
  followChat: "搜索跟随聊天服务",
  dailyLimit: "每日API限额",
  providers: "搜索API（每行填deepseek、zhihu或qwen；关闭跟随后使用）",
  mutedGroups: "静默群列表（每行一项）",
  stickers: "表情包总开关",
  javascriptPlugins: "JavaScript 插件总开关（完整系统权限）",
  staticSystem: "静态系统提示词缓存",
  envContext: "提示词包含环境信息",
  relations: "加载群聊关系",
  groupAddressGuard: "群聊指代校验",
  fightQuoteCheck: "争论引用校验",
  mediaCleanup: "自动清理媒体",
  memorySnapshot: "自动记忆快照",
};
let wbSettings,
  stickerCategory = "",
  ttsData,
  marketItems = [],
  voiceAudio;
function wxNotice(text = "发送到微信需要 Mac 微信桥接；当前未接入。") {
  return `<div class="hint warning">${esc(text)}</div>`;
}
function settingField(k, s, v) {
  const name = settingNames[k.split(".").at(-1)] || k;
  const label = esc(name) + ` <small class="config-key">${esc(k)}</small>`;
  if (s.type === "bool")
    return `<label class="check"><input type="checkbox" data-setting="${esc(k)}" ${v === true ? "checked" : ""}>${label}</label>`;
  if (s.type === "enum")
    return `<div class="field"><label>${label}</label><select data-setting="${esc(k)}">${s.values.map((x) => `<option value="${esc(x)}" ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>`;
  if (["windows", "list"].includes(s.type))
    return `<div class="field wide"><label>${label}</label><textarea rows="3" data-setting="${esc(k)}">${esc((v || []).join("\n"))}</textarea></div>`;
  const numeric = ["int", "float"].includes(s.type);
  return `<div class="field"><label>${label}</label><input data-setting="${esc(k)}" type="${numeric ? "number" : s.type === "clock" ? "time" : "text"}" value="${esc(v ?? "")}" ${numeric ? `step="${s.type === "int" ? "1" : "any"}" ${s.min !== undefined ? `min="${s.min}"` : ""} ${s.max !== undefined ? `max="${s.max}"` : ""}` : ""}></div>`;
}
function configForm(groups, id = "workbench-config") {
  const keys = Object.keys(wbSettings.schema).filter((k) =>
    groups.includes(k.split(".")[0]),
  );
  return `<form id="${id}" class="panel workbench-form"><div class="fields">${keys.map((k) => settingField(k, wbSettings.schema[k], wbSettings.values[k])).join("")}</div><div class="actions"><button class="primary" type="submit">保存设置</button></div></form>`;
}
async function getSettings() {
  wbSettings = await api("workbench-settings");
  return wbSettings;
}
workPages.stickers = async () => {
  await getSettings();
  const inv = await api("sticker-list", { category: stickerCategory });
  stickerCategory = inv.selected;
  $("#content").innerHTML =
    `<div class="panel"><h2>表情包图库</h2><p>沿用原版分类、图像校验与内置图库。导入图片、分类管理和本机预览已接入。</p>${wxNotice()}<div class="actions"><button data-action="sticker-enable">${inv.enabled ? "关闭" : "开启"}表情包</button><button data-action="sticker-import">导入图片</button><button data-action="sticker-presets">导入原版内置图库</button><button data-action="sticker-open">在 Finder 中打开</button></div><div class="category-tabs">${inv.emotions.map((x) => `<button data-action="sticker-select" data-id="${esc(x.key)}" class="${x.key === inv.selected ? "primary" : ""}">${esc(x.label)} · ${x.count}</button>`).join("")}</div><div class="sticker-grid">${inv.items.map((x) => `<div class="sticker-tile">${x.url ? `<img src="${x.url}" alt="${esc(x.id)}" loading="lazy">` : "<span>大图请在Finder查看</span>"}<small>${esc(x.id.split("/").at(-1))}</small><button class="danger" data-action="sticker-delete" data-id="${esc(x.id)}">移到废纸篓</button></div>`).join("") || '<div class="empty">此分类还没有图片，导入原版图库或选择本机图片。</div>'}</div><p>每个分类最多展示200张；更多图片可在Finder查看。</p><div class="actions"><input id="category-label" placeholder="自定义分类名称"><input id="category-new" placeholder="新名称（改名时填写）"><button data-action="category-add">新增分类</button><button data-action="category-rename">改名</button><button data-action="category-remove">移除分类（保留文件）</button></div></div>${configForm(["sticker"])}`;
};
workPages.speech = async () => {
  ttsData = await api("tts-state");
  speechRender();
};
function speechRender() {
  const p = ttsData.profile;
  $("#content").innerHTML =
    `<div class="panel"><h2>语音发送</h2><p>保留原版 BreezeBlue、MiniMax、硅基流动的模型与音色配置，增加 Mac 系统语音供本机直接试听。在线服务使用各自账户额度。</p>${wxNotice("本机合成、试听可用；微信语音录制与发送尚需 Mac 微信桥接及音频路由。Windows 的 CABLE Input 不能直接用于 Mac。")}</div><form id="speech-form" class="panel workbench-form"><h2>模型与音色</h2><div class="fields">${select(
      "语音厂商",
      "tts-provider",
      ttsData.provider,
      Object.entries(ttsData.providers).map(([k, v]) => [k, v.name]),
    )}${field("API Key（留空保留；各厂商独立加密保存）", "apiKey", "", "password", false, `placeholder="${ttsData.hasKey ? "已保存" : "未配置"}" autocomplete="off"`)}${field("模型 ID", "model", p.model)}${field("音色 ID", "voice", p.voice)}${ttsData.provider === "custom" ? field("接口地址", "baseUrl", p.baseUrl, "url", true) : ""}${area("语气指令（可选）", "instructions", p.instructions || "", 2)}${field("合成超时 / 秒", "timeout", p.timeout || 90, "number", false, 'min="5" max="90"')}${field("自动语音概率（0–1）", "chance", p.chance || 0, "number", false, 'min="0" max="1" step="0.05"')}${select(
      "语音服务连接方式",
      "proxyMode",
      p.proxyMode || "direct",
      [
        ["direct", "直接连接"],
        ["system", "系统代理"],
      ],
    )}<label class="check"><input type="checkbox" name="enabled" ${p.enabled ? "checked" : ""}>启用语音回复（发送等待微信桥接）</label></div><div class="actions"><button class="primary">保存语音设置</button><button type="button" data-action="tts-catalog">读取音色列表 / 测试 Key</button></div><div id="voice-catalog"></div></form><div class="panel"><h2>声音与测试</h2><textarea id="speech-text" rows="3" maxlength="1000">你好，我是鲸屿。很高兴见到你。</textarea><div class="actions"><button class="primary" data-action="tts-preview">合成并试听</button><button data-action="tts-stop">停止播放</button></div><div id="speech-player"></div></div>`;
}
workPages.reminders = async () => {
  await getSettings();
  const r = await api("reminder-list");
  $("#content").innerHTML =
    `<div class="panel"><h2>提醒任务</h2><p>本机通知在鲸屿运行且电脑唤醒时触发；超过5分钟未触发的旧提醒不补发。微信目标任务等待桥接。</p><form id="reminder-form" class="workbench-form"><div class="fields">${field("提醒内容", "text", "", "text", true, 'maxlength="200" required')}${field("提醒时间", "at", "", "datetime-local", false, "required")}${field("目标（local=本机通知；其他填写微信会话）", "target", "local")}</div><button class="primary">添加提醒</button></form>${r.items.map((x) => `<div class="row"><div><strong>${esc(x.text)}</strong><small>${esc(new Date(x.dueAt).toLocaleString())} · ${esc(x.name)} · ${esc(x.status)} ${x.wxid !== "isle-local" ? "· 等待微信桥接" : ""}</small></div>${["pending", "retrying"].includes(x.status) ? `<button data-action="reminder-cancel" data-id="${esc(x.id)}">取消</button>` : ""}</div>`).join("") || '<div class="empty">暂无提醒任务</div>'}</div><h2>主动搭话与提醒规则</h2>${wxNotice("主动微信搭话的时间窗、白名单与频率沿用原版配置；当前不会向微信自动发送。")}${configForm(["care", "reminder"])}`;
};
workPages.moments = async () => {
  await getSettings();
  const m = await api("moment-list");
  $("#content").innerHTML =
    `<div class="panel"><h2>朋友圈</h2>${wxNotice("朋友圈读取、点赞与发表依赖微信桥接，当前未接入；这里可以管理草稿和配置发表规则。")}<form id="moment-form" class="workbench-form">${area("新草稿", "text", "", 4)}<button class="primary">保存草稿</button></form>${m.drafts.map((d) => `<div class="row"><div><p>${esc(d.text)}</p><small>${esc(new Date(d.at).toLocaleString())}</small></div><button data-action="moment-delete" data-id="${esc(d.id)}">删除草稿</button></div>`).join("")}</div>${configForm(["moments"])}`;
};
workPages.diary = async () => {
  await getSettings();
  const d = await api("diary-list");
  $("#content").innerHTML =
    `<div class="panel"><h2>每日记忆 · 日记</h2><p>使用原版日记生成与存储逻辑，可从本机私聊生成当天日记；群聊和演示对话不计入。</p><div class="hint">${esc(d.status.message)}</div><div class="actions"><button class="primary" data-action="diary-generate">从当天私聊生成日记</button><button data-action="diary-refresh">刷新日记</button></div>${d.items.map((x) => `<details><summary>${esc(x.file)}</summary><pre>${esc(x.text)}</pre></details>`).join("") || '<div class="empty">尚未生成日记</div>'}</div><p>每天定时生成仅在应用运行时执行；微信发送需要桥接。</p>${configForm(["diary"])}`;
};
workPages.settings = async () => {
  await getSettings();
  const budget = await api("budget");
  $("#content").innerHTML =
    `<div class="panel"><h2>高级设置</h2>${Object.values(
      wbSettings.secretErrors || {},
    )
      .map((x) => `<div class="hint warning">${esc(x)}</div>`)
      .join(
        "",
      )}<p>下列设置直接使用原版内核校验与持久化。聊天模型和代理在“模型与连接”中配置。</p><div class="hint">人设估算：${budget.systemTokens} tokens · 对话预算：${budget.dialogueBudget} · 单轮最大输入：${budget.maxInputTokens} / ${budget.hardTotalTokens}${budget.overHardLimit ? " · 超出上限" : ""}</div></div><form id="settings-form" class="workbench-form">${[
      "chat",
      "group",
      "memory",
      "vision",
      "voice",
      "websearch",
      "links",
      "env",
      "storage",
      "log",
      "features",
    ]
      .map(
        (group) =>
          `<details class="panel" ${group === "features" ? "open" : ""}><summary>${groupNames[group]}</summary><div class="fields">${Object.entries(
            wbSettings.schema,
          )
            .filter(([k]) => k.startsWith(group + "."))
            .map(([k, s]) => settingField(k, s, wbSettings.values[k]))
            .join(
              "",
            )}${["vision", "voice", "websearch"].includes(group) ? field("服务密钥（留空保留，独立加密保存）", "secret-" + { vision: "vision", voice: "voice", websearch: "search" }[group], "", "password", true, `placeholder="${wbSettings.secrets[{ vision: "vision", voice: "voice", websearch: "search" }[group]] ? "已配置" : "未配置"}" autocomplete="off"`) : ""}${group === "websearch" ? field("知乎搜索 Secret（留空保留，独立加密）", "secret-search-zhihu", "", "password", true) : ""}</div></details>`,
      )
      .join(
        "",
      )}<div class="sticky-actions"><button class="primary">保存全部设置</button></div></form>`;
};
workPages.plugins = async () => {
  const p = await api("plugin-list");
  $("#content").innerHTML =
    `<div class="panel"><h2>插件市场</h2><p>读取原作者的插件目录，支持原版 ZIP 人设、Wasm 和 JavaScript 插件。安装后默认停用，更新会撤销旧授权。插件是否支持 Mac 取决于其代码。</p><div class="hint warning">JavaScript 插件具有完整系统权限。逐插件启用前会在原生对话框中确认；不要把市场校验当成安全保证。</div><div class="actions"><button data-nav="settings">JavaScript 总开关：${p.javascriptEnabled ? "已开启" : "未开启"} → 设置</button><button data-action="plugin-import">从本地 ZIP 安装</button><button data-action="plugin-catalog">刷新原版插件市场</button></div></div><h2>已安装</h2>${p.items.map((x) => `<section class="panel"><h3>${esc(x.name)} · ${esc(x.version)} <small>${x.enabled ? "已启用" : "已停用"}</small></h3><p>${esc(x.description)}</p><div class="actions"><button data-action="plugin-toggle" data-id="${esc(x.id)}">${x.enabled ? "停用" : "启用"}</button><button class="danger" data-action="plugin-delete" data-id="${esc(x.id)}">卸载（保留插件数据）</button></div><details><summary>设置与手动运行</summary><textarea id="plugin-settings-${esc(x.id)}" rows="5">${esc(JSON.stringify(x.settings, null, 2))}</textarea><button data-action="plugin-settings" data-id="${esc(x.id)}">保存 JSON 设置</button><textarea id="plugin-input-${esc(x.id)}" rows="3">{}</textarea><button data-action="plugin-run" data-id="${esc(x.id)}">运行一次</button></details></section>`).join("") || '<div class="panel empty">尚未安装插件</div>'}<h2>市场目录</h2><div id="market-catalog">${marketMarkup()}</div>`;
};
function marketMarkup() {
  return (
    marketItems
      .map(
        (x) =>
          `<div class="panel"><h3>${esc(x.name)} · ${esc(x.version)}</h3><small>${esc(x.author)} · API ${esc(x.api)} · ${esc(x.kind)}</small><p>${esc(x.description)}</p><button data-action="plugin-download" data-id="${esc(x.id)}">校验并安装</button></div>`,
      )
      .join("") ||
    '<div class="panel empty">点击“刷新原版插件市场”加载目录</div>'
  );
}
workPages.bridge = async () => {
  $("#content").innerHTML =
    `<div class="panel"><h2>Mac 微信桥接</h2><div class="hint warning">尚未接入 · 不具备微信自动收发能力</div><p>原版依赖 Windows 微信与 Windows 自动化接口。Mac 端需要独立实现账号识别、会话定位、接收去重、文本/表情/语音发送和结果确认，不能复用 Windows DLL 或虚拟声卡驱动。</p><p>本轮保留相关功能的配置和本机管理；依赖微信的操作会标注等待桥接。</p></div><div class="panel"><h2>DeepSeek Harness</h2><div class="hint">尚未接入 · 本轮先完成原版工作台迁移</div><p>目标链路：微信消息 → 鲸屿 → DSH 执行任务 → 鲸屿回传微信。模型 API 连接与 DSH 执行任务是两项独立能力。</p></div>`;
};
const oldMemoryPage = memory;
memory = async function () {
  await oldMemoryPage();
  $("#content").insertAdjacentHTML(
    "afterbegin",
    '<div class="panel"><h2>记忆备份与恢复</h2><div class="actions"><button data-action="memory-backup">导出记忆备份</button><button data-action="memory-restore">导入备份并重启恢复</button></div><p>恢复前会保留当前数据快照；点击会话的“查看”可阅读原文与记忆摘要。</p></div>',
  );
  const rows = await api("memory-list");
  for (const r of rows) {
    const el = [
      ...document.querySelectorAll('[data-action="memory-clear"]'),
    ].find((x) => x.dataset.id === r.key);
    if (el)
      el.insertAdjacentHTML(
        "beforebegin",
        `<button data-action="memory-detail" data-id="${esc(r.key)}">查看</button>`,
      );
  }
};
const oldPromptPage = promptPage;
promptPage = function () {
  oldPromptPage();
  $("#content").insertAdjacentHTML(
    "afterbegin",
    `<div class="panel"><h2>原版完整提示词</h2><p>已内置七份原版预设，保留完整提示词、原始 JSON、来源与 SHA-256。性格/背景字段是从原文整理的摘要；原文没有的职业/外观保持空白。内核的通用规则仍由原版提示词组装器参与生成，可点击“预览生效提示词”检查。</p><div class="actions"><button data-action="original-view">查看七份原始人设与完整原文</button><button data-action="original-restore">重新导入全部原版预设</button></div></div>`,
  );
};
Object.assign(actions, {
  "memory-detail": async (key) => {
    const r = await api("memory-detail", { key });
    modal("对话原文与记忆", JSON.stringify(r, null, 2));
  },
  "memory-restore": async () => {
    const r = await api("memory-restore");
    if (r.ok) toast("已安排重启恢复");
  },
  "original-view": async () => {
    const list = await api("original-list");
    modal(
      "原版人设 · 完整原文与来源",
      list
        .map(
          (x) =>
            x.name +
            "\n来源：" +
            x.provenance.path +
            "\nSHA-256：" +
            x.provenance.sha256 +
            "\n\n" +
            JSON.stringify(x.original, null, 2),
        )
        .join("\n\n────────────────\n\n"),
    );
  },
  "original-restore": async () => {
    if (
      confirm("重新导入七份原版预设？同ID的预设将恢复原文，当前生效角色不变。")
    ) {
      state = await api("original-restore");
      render();
      toast("七份原版预设已导入");
    }
  },
  "sticker-select": async (id) => {
    stickerCategory = id;
    await workPages.stickers();
  },
  "sticker-enable": async () => {
    await api("workbench-save", {
      patch: { "features.stickers": !wbSettings.values["features.stickers"] },
    });
    await workPages.stickers();
  },
  "sticker-import": async () => {
    await api("sticker-import", { category: stickerCategory });
    await workPages.stickers();
  },
  "sticker-delete": async (id) => {
    await api("sticker-delete", { id });
    await workPages.stickers();
  },
  "sticker-presets": async () => {
    const r = await api("sticker-presets");
    toast("已导入原版图库：" + JSON.stringify(r.copied));
    await workPages.stickers();
  },
  "sticker-open": () => api("sticker-open"),
  "category-add": () => categoryAction("add"),
  "category-rename": () => categoryAction("rename"),
  "category-remove": () => categoryAction("remove"),
  "tts-catalog": async () => {
    if (dirty) throw Error("请先保存语音配置");
    const c = await api("tts-catalog");
    $("#voice-catalog").innerHTML =
      '<p>点击音色即可填入，再保存设置。</p><div class="voice-choices">' +
      c.voices
        .map(
          (x) =>
            `<button type="button" data-action="tts-voice" data-id="${esc(x.id)}">${esc(x.name || x.id)}</button>`,
        )
        .join("") +
      '</div><p>模型列表</p><div class="voice-choices">' +
      c.models
        .map(
          (x) =>
            `<button type="button" data-action="tts-model" data-id="${esc(x.id)}">${esc(x.name || x.id)}</button>`,
        )
        .join("") +
      "</div>";
    toast("语音服务连接成功");
  },
  "tts-model": (id) => {
    $("#model").value = id;
    dirty = true;
  },
  "tts-voice": (id) => {
    $("#voice").value = id;
    dirty = true;
  },
  "tts-preview": async () => {
    if (dirty) throw Error("请先保存语音配置");
    toast("正在合成语音…");
    const r = await api("tts-preview", { text: $("#speech-text").value });
    voiceAudio?.pause();
    $("#speech-player").innerHTML =
      `<audio controls src="${r.url}"></audio><p>${Math.round(r.bytes / 1024)} KB</p>`;
    voiceAudio = $("#speech-player audio");
    await voiceAudio.play().catch(() => {});
    toast("音频已生成");
  },
  "tts-stop": () => voiceAudio?.pause(),
  "reminder-cancel": async (id) => {
    await api("reminder-cancel", { id });
    await workPages.reminders();
  },
  "diary-generate": async () => {
    toast("正在生成当天日记…");
    const r = await api("diary-generate");
    await workPages.diary();
    toast(r.message);
  },
  "diary-refresh": () => workPages.diary(),
  "moment-delete": async (id) => {
    await api("moment-delete", { id });
    await workPages.moments();
  },
  "plugin-import": async () => {
    await api("plugin-import");
    await workPages.plugins();
  },
  "plugin-catalog": async () => {
    toast("正在读取原版插件市场…");
    marketItems = await api("plugin-catalog");
    $("#market-catalog").innerHTML = marketMarkup();
  },
  "plugin-download": async (id) => {
    const r = await api("plugin-download", { id });
    await workPages.plugins();
    toast(r.canceled ? "已取消" : "插件已安装，尚未启用");
  },
  "plugin-toggle": async (id) => {
    const p = await api("plugin-list");
    const x = p.items.find((x) => x.id === id);
    await api("plugin-toggle", { id, enabled: !x.enabled });
    await workPages.plugins();
  },
  "plugin-delete": async (id) => {
    if (confirm("卸载此插件？插件数据目录保留。")) {
      await api("plugin-delete", { id });
      await workPages.plugins();
    }
  },
  "plugin-settings": async (id) => {
    await api("plugin-settings", {
      id,
      settings: $("#plugin-settings-" + id).value,
    });
    dirty = false;
    toast("插件设置已保存");
  },
  "plugin-run": async (id) => {
    if (dirty) throw Error("请先保存插件设置");
    const r = await api("plugin-run", {
      id,
      input: $("#plugin-input-" + id).value,
    });
    modal("插件运行结果", JSON.stringify(r, null, 2));
  },
});
async function categoryAction(operation) {
  await api("sticker-category", {
    operation,
    label: $("#category-label").value,
    newLabel: $("#category-new").value,
  });
  await workPages.stickers();
}
document.addEventListener("change", (e) => {
  if (e.target.id === "tts-provider") {
    if (dirty && !confirm("切换厂商会放弃未保存的内容，继续？")) {
      e.target.value = ttsData.provider;
      return;
    }
    const id = e.target.value;
    ttsData.provider = id;
    ttsData.profile = { ...ttsData.providers[id], ...ttsData.profiles[id] };
    ttsData.hasKey = false;
    speechRender();
    dirty = true;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.closest(".workbench-form")) dirty = true;
  if (e.target.dataset.setting) e.target.dataset.touched = "true";
});
document.addEventListener("submit", (e) => {
  if (!e.target.matches(".workbench-form")) return;
  e.preventDefault();
  run(async () => {
    if (e.target.id === "speech-form") {
      const d = formValues(e.target);
      d.provider = d["tts-provider"];
      ttsData = await api("tts-save", d);
      dirty = false;
      speechRender();
      toast("语音配置已保存");
      return;
    }
    if (e.target.id === "reminder-form") {
      const d = formValues(e.target);
      d.at = new Date(d.at).getTime();
      await api("reminder-add", d);
      dirty = false;
      await workPages.reminders();
      toast("提醒已保存");
      return;
    }
    if (e.target.id === "moment-form") {
      await api("moment-draft", formValues(e.target));
      dirty = false;
      await workPages.moments();
      toast("草稿已保存");
      return;
    }
    const patch = {};
    for (const el of e.target.querySelectorAll("[data-setting]")) {
      const k = el.dataset.setting,
        s = wbSettings.schema[k];
      if (wbSettings.values[k] === undefined && !el.dataset.touched) continue;
      patch[k] =
        s.type === "bool"
          ? el.checked
          : ["int", "float"].includes(s.type)
            ? Number(el.value)
            : ["windows", "list"].includes(s.type)
              ? el.value
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean)
              : el.value;
    }
    const secrets = {};
    for (const id of ["vision", "voice", "search", "search-zhihu"]) {
      const el = e.target.querySelector('[name="secret-' + id + '"]');
      if (el?.value) secrets[id] = el.value;
    }
    await api("workbench-save", { patch, secrets });
    state = await api("state");
    dirty = false;
    render();
    toast("设置已保存");
  });
});
