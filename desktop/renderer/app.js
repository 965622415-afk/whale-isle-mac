"use strict";
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pages = [
  ["home", "◒", "总览"],
  ["models", "◈", "模型与连接"],
  ["persona", "◇", "角色设定"],
  ["prompts", "≋", "提示词与预设"],
  ["chat", "◌", "本机试聊"],
  ["memory", "▤", "对话与记忆"],
  ["diagnostics", "⌁", "诊断与关于"],
];
let draftModel = null;
let state,
  page = "home",
  selectedModel = "",
  dirty = false,
  busy = false,
  messages = [],
  lastPrompt = "",
  mode = "private",
  demo = false,
  toastTimer;
async function api(action, input = {}) {
  const r = await window.isle.invoke(action, input);
  if (!r.ok) throw new Error(r.error || "操作失败");
  return r.value;
}
function toast(text, error = false) {
  const el = $("#toast");
  el.textContent = text;
  el.className = "show" + (error ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 5000);
}
async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
  }
}
function field(
  label,
  name,
  value = "",
  type = "text",
  wide = false,
  extra = "",
) {
  return `<div class="field ${wide ? "wide" : ""}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
}
function area(label, name, value = "", rows = 4) {
  return `<div class="field wide"><label for="${name}">${label}</label><textarea id="${name}" name="${name}" rows="${rows}">${esc(value)}</textarea></div>`;
}
function select(label, name, value, items) {
  return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${items.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
}
const active = () =>
  state.profiles.find((p) => p.id === state.activeProfile) || state.profiles[0];
function route(target) {
  if (dirty && !confirm("还有未保存的配置，离开此页？")) return;
  draftModel = null;
  page = target;
  render();
}
function render() {
  dirty = false;
  $("#page-title").textContent = pages.find((p) => p[0] === page)[2];
  $("#active-model").textContent = active().name + " / " + active().model;
  $("#nav").innerHTML = pages
    .map(
      ([id, icon, name]) =>
        `<button data-nav="${id}" class="${id === page ? "active" : ""}"><span>${icon}</span>${name}</button>`,
    )
    .join("");
  run(() =>
    ({
      home,
      models,
      persona,
      prompts: promptPage,
      chat: loadChat,
      memory,
      diagnostics,
      ...workPages,
    })[page](),
  );
}
function home() {
  const p = active();
  $("#content").innerHTML =
    `<div class="hero"><div><div class="tag">A LITTLE ISLAND, ALL YOUR OWN</div><h2>让你的 AI，有自己的样子。</h2><p>从一个角色、一份提示词开始。<br>在这里配置、试聊，慢慢找到你想要的表达。</p><div class="actions"><button class="primary" data-nav="chat">开始试聊 ↗</button><button class="ghost" data-nav="prompts">编辑提示词</button></div></div><div class="island" aria-hidden="true"></div></div><div class="grid"><div class="card"><div class="card-title">当前模型</div><div class="card-value">${esc(p.name)}</div><div class="card-note">${esc(p.model)} · ${p.hasKey ? "密钥已加密保存" : p.provider === "ollama" ? "本机服务" : "等待配置密钥"}</div></div><div class="card"><div class="card-title">正在使用的角色</div><div class="card-value">${esc(state.persona.name)}</div><div class="card-note">${state.presets.length} 份个人预设 · 可随时切换</div></div><div class="card"><div class="card-title">连接方式</div><div class="card-value">${{ direct: "直接连接", system: "系统代理", manual: "指定代理" }[p.proxyMode]}</div><div class="card-note">${p.timeout} 秒请求超时 · 本机独立配置</div></div></div><div class="section-title"><h2>把配置变成体验</h2><small>01 / 02 / 03</small></div><div class="panel"><div class="row"><div><strong>01　连接一个模型</strong><small>填写 API 密钥，并用真实请求测试连接。</small></div><button data-nav="models">模型设置 →</button></div><div class="row"><div><strong>02　定义角色与表达</strong><small>角色背景与提示词分开编辑，预设可以导入、导出。</small></div><button data-nav="persona">角色设定 →</button></div><div class="row"><div><strong>03　在本机对话中验证</strong><small>支持私聊与群聊模拟，查看模型实际收到的提示词。</small></div><button data-nav="chat">打开试聊 →</button></div></div><div class="footer-note">鲸屿 ${esc(state.version)} · macOS ${esc(state.arch)}<br>已接入人设、表情图库、语音试听、提醒、日记、插件和高级设置；微信与 DSH 尚未接入。</div>`;
}
function models() {
  const p =
    (draftModel?.id === selectedModel ? draftModel : null) ||
    state.profiles.find((p) => p.id === selectedModel) ||
    active();
  selectedModel = p.id;
  $("#content").innerHTML =
    `<div class="split"><div class="model-list">${state.profiles
      .concat(draftModel ? [draftModel] : [])
      .map(
        (x) =>
          `<button data-model="${esc(x.id)}" class="${x.id === p.id ? "current" : ""}"><strong>${esc(x.name)} ${x.id === state.activeProfile ? "· 当前" : ""}</strong><small>${esc(x.model)}</small></button>`,
      )
      .join(
        "",
      )}<button class="add" data-action="model-new">＋ 添加模型配置</button></div><section><form id="model-form" class="panel"><h2>${esc(p.name)}</h2><p>每个配置独立保存连接方式与密钥。API 密钥不会包含在人设导出文件中。</p><input type="hidden" name="id" value="${esc(p.id)}"><div class="fields">${field("配置名称", "name", p.name)}${select(
      "模型接口类型",
      "provider",
      p.provider,
      [
        ["deepseek", "DeepSeek 官方"],
        ["custom", "OpenAI 兼容接口"],
        ["ollama", "Ollama 本机模型"],
      ],
    )}${field("API 地址", "baseUrl", p.baseUrl, "url", true)}${field("模型名称", "model", p.model)}${field("API 密钥（留空保留已有密钥）", "apiKey", "", "password", false, `placeholder="${p.hasKey ? "已配置 · 输入新密钥可替换" : "请填写服务商提供的 API 密钥"}" autocomplete="off"`)}${select(
      "连接方式",
      "proxyMode",
      p.proxyMode,
      [
        ["direct", "直连"],
        ["system", "跟随系统代理"],
        ["manual", "指定 HTTP 代理"],
      ],
    )}${field("代理地址", "proxyUrl", p.proxyUrl)}${field("请求超时 / 秒", "timeout", p.timeout, "number", false, 'min="10" max="600"')}${field("温度 / Temperature", "temperature", p.temperature, "number", false, 'min="0" max="2" step="0.1"')}<label class="check"><input type="checkbox" name="thinking" ${p.thinking ? "checked" : ""}>启用模型深度思考</label></div><div class="hint">DeepSeek 官方可选择直连。OpenAI 可指定 Clash 的 HTTP 代理端口。这里的 API 地址应填写模型服务地址，而非代理地址。仅支持 Chat Completions 兼容接口。</div><div class="actions"><button type="submit" class="primary">保存并启用</button><button type="button" data-action="probe">测试当前连接</button><button type="button" class="danger" data-action="key-clear" data-id="${esc(p.id)}">清除密钥</button><button type="button" class="ghost" data-action="model-delete" data-id="${esc(p.id)}">删除配置</button></div><div id="probe-result">${probeMarkup(state.lastProbe)}</div></form></section></div>`;
}
function probeMarkup(p) {
  return p
    ? `<div class="hint ${p.ok ? "success" : "warning"}">${p.ok ? "✓" : "!"} ${esc(p.message)} · ${(p.elapsed / 1000).toFixed(1)} 秒${p.detail ? "<br>" + esc(p.detail) : ""}</div>`
    : "";
}
function persona() {
  const p = state.persona;
  $("#content").innerHTML =
    `<form id="persona-form" class="panel"><h2>角色的基本轮廓</h2><p>这些设定会参与上游人设内核的提示词组装。更细的行为要求可在“提示词与预设”中填写。</p><div class="fields">${field("角色名称", "name", p.name)}${field("怎么称呼你", "ownerName", p.ownerName)}${field("角色年龄", "age", p.age, "number", false, 'min="1" max="120"')}${field("身份 / 职业", "job", p.job)}${area("性格与表达", "personality", p.personality, 3)}${area("背景设定", "background", p.background, 3)}${area("外观设定（可留空）", "appearance", p.appearance, 2)}${field("私聊回复字数上限", "privateMaxChars", p.privateMaxChars, "number", false, 'min="40" max="800"')}${field("群聊回复字数上限", "groupMaxChars", p.groupMaxChars, "number", false, 'min="20" max="300"')}${field("私聊上下文条数", "historyTurns", p.historyTurns, "number", false, 'min="4" max="400"')}${field("群聊上下文条数", "groupHistoryTurns", p.groupHistoryTurns, "number", false, 'min="2" max="300"')}${select(
      "表情使用习惯",
      "emoji",
      p.emoji,
      [
        ["少", "少用"],
        ["正常", "正常"],
        ["多", "多用"],
      ],
    )}${area("呼唤别名（每行一个）", "aliases", (p.aliases || []).join("\n"), 2)}${field("最多回复分段", "maxBubbles", p.maxBubbles || 2, "number", false, 'min="1" max="8"')}${field("讨论场景字数上限", "discussionMaxChars", p.discussionMaxChars || 400, "number", false, 'min="20" max="4000"')}${field("文字表情概率", "emojiChance", p.emojiChance || 0, "number", false, 'min="0" max="1" step="0.05"')}<label class="check"><input type="checkbox" name="masterRoast" ${p.masterRoast ? "checked" : ""}>允许对主人还嘴</label><label class="check"><input type="checkbox" name="proactive" ${p.proactive ? "checked" : ""}>人格允许主动搭话</label><label class="check"><input type="checkbox" name="opinions" ${p.opinions ? "checked" : ""}>允许表达自己的看法</label></div><div class="actions"><button class="primary" type="submit">保存角色设定</button><button type="button" data-nav="prompts">继续编辑提示词 →</button></div></form>`;
}
function promptPage() {
  const p = state.prompts;
  $("#content").innerHTML =
    `<form id="prompt-form" class="panel"><h2>让规则清楚，也让角色自由</h2><p>留空时沿用角色设定。私聊、群聊规则按当前试聊场景分别生效，不会互相混入。</p><div class="fields">${area("核心角色提示词", "role", p.role, 5)}${area("说话风格与示例", "style", p.style, 4)}${area("私聊专属规则", "private", p.private, 3)}${area("群聊专属规则", "group", p.group, 3)}${area("行为边界 / 事实与隐私要求", "boundaries", p.boundaries, 3)}</div><div class="actions"><button class="primary" type="submit">保存提示词</button><button type="button" data-action="prompt-preview">预览生效提示词</button></div></form><div class="section-title"><h2>我的预设</h2><small>包含角色与提示词，不含 API 密钥</small></div><section class="panel"><div class="actions"><input class="preset-name" id="preset-name" placeholder="预设名称，例如：温和的工作伙伴" maxlength="80"><button class="primary" data-action="preset-save">保存为预设</button><button data-action="preset-import">导入 JSON</button><button data-action="preset-export">导出当前设定</button></div>${state.presets.length ? state.presets.map((p) => `<div class="row"><strong>${esc(p.name)}</strong><div class="actions"><button data-action="preset-apply" data-id="${esc(p.id)}">使用</button><button class="ghost danger" data-action="preset-delete" data-id="${esc(p.id)}">删除</button></div></div>`).join("") : '<div class="empty">先保存角色和提示词，再把它们收进一份预设。</div>'}</section>`;
}
function messageMarkup(m) {
  return `<div class="message ${m.role === "user" ? "user" : ""} ${m.error ? "error" : ""}">${esc(m.text || "正在思考…")}${m.meta ? '<div class="message-meta">' + esc(m.meta) + "</div>" : ""}</div>`;
}
async function loadChat() {
  if (!busy) messages = await api("chat-history", { mode, demo });
  if (page === "chat") chat();
}
function chat() {
  $("#content").innerHTML =
    `<div class="chat-layout"><div class="chat-top"><div class="check"><span class="status-dot"></span><strong>${esc(state.persona.name)}</strong><span class="badge ${demo ? "gray" : ""}">${demo ? "本地演示" : "真实模型"}</span></div><div class="check"><select id="chat-mode" ${busy ? "disabled" : ""}><option value="private" ${mode === "private" ? "selected" : ""}>私聊模拟</option><option value="group" ${mode === "group" ? "selected" : ""}>群聊模拟</option></select><label class="check"><input type="checkbox" id="chat-demo" ${demo ? "checked" : ""} ${busy ? "disabled" : ""}>演示模式</label><button data-action="chat-new" ${busy ? "disabled" : ""}>新对话</button></div></div><div id="messages" class="messages">${messages.length ? messages.map(messageMarkup).join("") : '<div class="empty"><strong>从一句你好开始。</strong>这里的对话只发生在本机试聊中。<br>还没有 API 密钥？可勾选演示模式检查界面与记忆流程。</div>'}</div><form id="chat-form" class="chat-compose"><textarea id="chat-input" placeholder="发一条消息，看看角色如何回应…（最多 2000 字）" maxlength="2000" ${busy ? "disabled" : ""}></textarea><div class="actions"><small>⌘ Enter 发送 · 可在诊断中查看实际提示词</small><div><button type="button" data-action="last-prompt">本轮提示词</button> <button class="primary" type="${busy ? "button" : "submit"}" ${busy ? 'data-action="chat-stop"' : ""}>${busy ? "停止生成" : "发送消息 ↗"}</button></div></div></form></div>`;
  scrollMessages();
}
function scrollMessages() {
  const m = $("#messages");
  if (m) m.scrollTop = m.scrollHeight;
}
async function memory() {
  const el = $("#content");
  el.innerHTML = '<div class="loading">正在读取本机记忆…</div>';
  const chats = await api("memory-list");
  if (page !== "memory") return;
  el.innerHTML = `<section class="panel"><h2>对话会留下什么</h2><p>沿用原项目按会话隔离的本机记忆机制。备份包含本机试聊内容和记忆，请存放在你信任的位置。</p><div class="actions"><button class="primary" data-action="memory-backup">导出记忆备份</button><button data-action="open-data">打开数据目录</button></div></section><section class="panel">${chats.length ? chats.map((c, i) => `<div class="row"><div><strong>${esc(c.title || "试聊会话 " + (i + 1))}</strong><small>${c.chatType === "group" ? "群聊模拟" : "私聊模拟"} · ${c.messageCount} 条消息 · ${c.peopleCount} 张人物卡<br>${new Date(c.lastActiveAt).toLocaleString("zh-CN")}</small></div><button class="danger" data-action="memory-clear" data-id="${esc(c.key)}">备份并清空</button></div>`).join("") : '<div class="empty"><strong>还没有试聊记忆</strong>完成一次对话后，可以在这里查看会话统计和备份。</div>'}</section>`;
}
async function diagnostics() {
  const el = $("#content");
  el.innerHTML = `<section class="panel"><h2>连接诊断</h2><p>测试会真实调用当前模型，可能产生少量 API 用量。未配置密钥时不会把演示回复当成连接成功。</p><div class="actions"><button class="primary" data-action="probe">测试当前连接</button><button data-action="open-data">打开数据目录</button><button data-action="prompt-preview">预览提示词</button></div><div id="probe-result">${probeMarkup(state.lastProbe)}</div></section><section class="panel"><h2>诊断日志</h2><p>展示最近 100 行，密钥会脱敏。不会在此页面输出完整配置文件。</p><pre id="log-content">读取中…</pre></section><section class="panel"><h2>关于鲸屿</h2><p>鲸屿 · AI 配置中心 ${esc(state.version)}<br>专为 macOS 打造的独立桌面配置中心。此版本不包含微信桥接。<br>基于 Banan1cee/whale_girl 的模型、人设、对话与记忆内核开发，遵循 AGPL-3.0-only。<br>应用密钥通过 macOS 支持的安全存储加密；预设导出不包含密钥。</p><p>你的源码仓库：github.com/965622415-afk/whale-isle-mac<br>上游项目：github.com/Banan1cee/whale_girl</p><p>本机数据目录：${esc(state.dataDir)}</p></section>`;
  const logs = await api("logs");
  if (page === "diagnostics") $("#log-content").textContent = logs;
}
function modal(title, text) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = "<pre></pre>";
  $("#modal-body pre").textContent = text;
  $("#modal").showModal();
}
function formValues(form) {
  const d = Object.fromEntries(new FormData(form));
  for (const e of form.querySelectorAll("input[type=checkbox]"))
    d[e.name] = e.checked;
  return d;
}
async function save(action, data, message) {
  state = await api(action, data);
  draftModel = null;
  render();
  toast(message);
}
const actions = {
  "model-new": () => {
    if (dirty && !confirm("放弃未保存的配置？")) return;
    const p = {
      id: crypto.randomUUID(),
      name: "新模型",
      provider: "custom",
      baseUrl: "https://api.openai.com/v1",
      model: "",
      proxyMode: "manual",
      proxyUrl: "http://127.0.0.1:7897",
      timeout: 120,
      temperature: 0.8,
      thinking: false,
    };
    draftModel = p;
    selectedModel = p.id;
    models();
    dirty = true;
  },
  "model-delete": async (id) => {
    if (confirm("删除此模型配置及其密钥？")) {
      await save("model-delete", { id }, "模型配置已删除");
      selectedModel = "";
      render();
    }
  },
  "key-clear": async (id) => {
    if (confirm("清除这个配置中保存的 API 密钥？"))
      await save("key-clear", { id }, "密钥已清除");
  },
  probe: async () => {
    if (dirty) throw new Error("请先保存配置，再测试当前连接");
    const el = $("#probe-result");
    if (el) el.innerHTML = '<div class="hint">正在请求真实模型，请稍候…</div>';
    const result = await api("probe");
    state.lastProbe = result;
    if ($("#probe-result")) $("#probe-result").innerHTML = probeMarkup(result);
    toast(result.message, !result.ok);
  },
  "prompt-preview": async () => {
    if (dirty) throw new Error("请先保存提示词，再预览生效内容");
    const p = await api("prompt-preview", { mode });
    modal("当前生效提示词 · " + (mode === "group" ? "群聊" : "私聊"), p.prompt);
  },
  "preset-save": async () => {
    if (dirty) throw new Error("请先保存提示词");
    const name = $("#preset-name").value.trim();
    if (!name) throw new Error("请填写预设名称");
    await save("preset-save", { name }, "已保存为预设");
  },
  "preset-apply": async (id) => {
    if (confirm("使用此预设替换当前角色与提示词？"))
      await save("preset-apply", { id }, "预设已生效");
  },
  "preset-delete": async (id) => {
    if (confirm("删除这份预设？当前生效设定不变。"))
      await save("preset-delete", { id }, "预设已删除");
  },
  "preset-import": async () => {
    state = await api("preset-import");
    render();
  },
  "preset-export": async () => {
    if (dirty) throw new Error("请先保存提示词");
    const r = await api("preset-export");
    if (r.ok) toast("已导出，不包含密钥");
  },
  "open-data": () => api("open-data"),
  "memory-backup": async () => {
    const r = await api("memory-backup");
    if (r.ok) toast("本机记忆已备份");
  },
  "memory-clear": async (key) => {
    await api("memory-clear", { key });
    await memory();
  },
  "chat-new": async () => {
    state = await api("chat-new");
    messages = [];
    lastPrompt = "";
    chat();
    toast("已创建新对话，旧会话记忆仍保留");
  },
  "chat-stop": () => api("chat-stop"),
  "last-prompt": () =>
    modal(
      "本轮实际提示词",
      lastPrompt || "发送一条消息后，可以在这里查看本轮实际提示词。",
    ),
};
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    route(nav.dataset.nav);
    return;
  }
  const model = e.target.closest("[data-model]");
  if (model) {
    if (dirty && !confirm("放弃未保存的配置？")) return;
    draftModel = null;
    selectedModel = model.dataset.model;
    render();
    return;
  }
  const a = e.target.closest("[data-action]");
  if (a && !a.disabled)
    run(async () => {
      a.disabled = true;
      try {
        await actions[a.dataset.action]?.(a.dataset.id);
      } finally {
        if (a.isConnected) a.disabled = false;
      }
    });
});
document.addEventListener("input", (e) => {
  if (e.target.closest("#model-form,#persona-form,#prompt-form")) dirty = true;
});
document.addEventListener("change", (e) => {
  if (e.target.closest("#model-form,#persona-form,#prompt-form")) dirty = true;
  if (e.target.id === "chat-mode") {
    mode = e.target.value;
    run(loadChat);
  }
  if (e.target.id === "chat-demo") {
    demo = e.target.checked;
    run(loadChat);
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.closest("#modal")) return;
  e.preventDefault();
  run(async () => {
    if (e.target.id === "model-form") {
      const d = formValues(e.target);
      await save("model-save", d, "模型配置已保存并启用");
    }
    if (e.target.id === "persona-form")
      await save("persona-save", formValues(e.target), "角色设定已保存");
    if (e.target.id === "prompt-form")
      await save("prompts-save", formValues(e.target), "提示词已保存");
    if (e.target.id === "chat-form") {
      const text = $("#chat-input").value.trim();
      if (!text || busy) return;
      busy = true;
      messages.push({ role: "user", text }, { role: "assistant", text: "" });
      chat();
      try {
        const r = await api("chat", { text, mode, demo });
        const m = messages.at(-1);
        m.text = r.text;
        m.meta =
          (r.demo ? "本地演示 · 未调用 API" : "真实模型") +
          " · " +
          ((r.elapsed || 0) / 1000).toFixed(1) +
          " 秒" +
          (r.usage ? " · " + r.usage.totalTokens + " tokens" : "");
      } catch (err) {
        const m = messages.at(-1);
        m.text = err.message;
        m.error = true;
      } finally {
        busy = false;
        state = await api("state");
        if (page === "chat") chat();
      }
    }
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.metaKey && e.target.id === "chat-input") {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});
window.isle.onChat((data) => {
  if (data.type === "prompt")
    lastPrompt =
      data.system +
      "\n\n" +
      data.turns.map((t) => t.role + ": " + t.content).join("\n\n");
  if (data.type === "delta" && messages.length) {
    messages.at(-1).text += data.text;
    if (page === "chat") {
      const el = $("#messages").lastElementChild;
      el.textContent = messages.at(-1).text;
      scrollMessages();
    }
  }
});
$("#refresh").onclick = () =>
  run(async () => {
    if (dirty && !confirm("放弃未保存的配置并刷新？")) return;
    state = await api("state");
    render();
    toast("状态已刷新");
  });
document.addEventListener("DOMContentLoaded", () =>
  run(async () => {
    state = await api("state");
    render();
  }),
);
