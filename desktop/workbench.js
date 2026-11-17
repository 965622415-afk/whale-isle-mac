"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const { atomic, profile, composePrompt } = require("./state");
const { FIELDS, getByPath } = require("../src/infra/configSchema");
const { applyConfigPatch } = require("../src/infra/configPatch");
const stickers = require("../src/adapters/stickers");
const { originals } = require("./original-presets");
const GROUPS = [
  "chat",
  "group",
  "care",
  "reminder",
  "diary",
  "moments",
  "sticker",
  "memory",
  "voice",
  "links",
  "websearch",
  "env",
  "storage",
  "log",
];
const EXCLUDED = new Set([
  "moments.publishAccount",
  "log.traceRaw",
  "env.autoDetect",
  "memory.maxSessions",
  "memory.maxNotesPerUser",
]);
const EXTRA = {
  "features.stickers": { type: "bool" },
  "features.javascriptPlugins": { type: "bool" },
  "features.staticSystem": { type: "bool" },
  "features.envContext": { type: "bool" },
  "features.relations": { type: "bool" },
  "features.groupAddressGuard": { type: "bool" },
  "features.fightQuoteCheck": { type: "bool" },
  "features.mediaCleanup": { type: "bool" },
  "features.memorySnapshot": { type: "bool" },
  "diary.sendToOwner": { type: "bool" },
  "care.whitelist": { type: "list" },
  "group.mutedGroups": { type: "list" },
  "websearch.city": { type: "string", maxLen: 40 },
  "websearch.api.providers": { type: "list" },
  "vision.baseUrl": { type: "string", maxLen: 500 },
  "vision.model": { type: "string", maxLen: 120 },
  "vision.timeoutMs": { type: "int", min: 1000, max: 300000 },
};
const SCHEMA = Object.fromEntries(
  Object.entries({ ...FIELDS, ...EXTRA }).filter(
    ([k]) =>
      (GROUPS.includes(k.split(".")[0]) || k in EXTRA) &&
      !EXCLUDED.has(k) &&
      !/apiKey|accessSecret/.test(k),
  ),
);
const TTS = {
  system: { name: "macOS 系统语音", model: "system", voice: "Tingting" },
  breezeblue: {
    name: "BreezeBlue",
    baseUrl: "https://api.breeze.blue/v1",
    model: "breeze-tts-2",
    voice: "voc_u3nxkd5578wc",
  },
  minimax: {
    name: "MiniMax",
    baseUrl: "https://api.minimax.cn/v1",
    model: "speech-2.8-turbo",
    voice: "qiaopi_mengmei",
  },
  siliconflow: {
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "FunAudioLLM/CosyVoice2-0.5B",
    voice: "FunAudioLLM/CosyVoice2-0.5B:claire",
  },
  custom: {
    name: "自定义语音接口",
    baseUrl: "https://api.example.com/v1",
    model: "tts",
    voice: "default",
  },
};
function put(obj, dotted, value) {
  const keys = dotted.split(".");
  let p = obj;
  for (const k of keys.slice(0, -1)) p = p[k] ||= {};
  p[keys.at(-1)] = value;
}
function short(v, max = 500) {
  if (typeof v !== "string" || v.length > max)
    throw Error("文本格式或长度无效");
  return v.trim();
}
function inside(root, file) {
  const r = fs.realpathSync(root),
    f = fs.realpathSync(file);
  if (!f.startsWith(r + path.sep) || !fs.statSync(f).isFile())
    throw Error("文件不在图库内");
  return f;
}
class Workbench {
  constructor(host, source) {
    this.h = host;
    this.source = source;
    this.file = path.join(host.root, "workbench.json");
    this.data = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : { ttsProvider: "system", ttsProfiles: {}, drafts: [] };
    this.voiceSession = host.e.session.fromPartition("isle-voice");
    this.timer = null;
  }
  save() {
    atomic(this.file, this.data);
  }
  async start() {
    await this.voiceSession.setProxy({ mode: "direct" });
    await this.hydrate();
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
  }
  async hydrate() {
    this.secretErrors = {};
    for (const [id, key] of [
      ["vision", "vision.apiKey"],
      ["voice", "voice.apiKey"],
      ["search", "websearch.deepseek.apiKey"],
      ["search-zhihu", "websearch.zhihu.accessSecret"],
    ])
      try {
        put(this.h.runtime.config, key, await this.h.secret("service-" + id));
      } catch {
        put(this.h.runtime.config, key, "");
        this.secretErrors[id] = "密钥无法解密，请重新填写此服务密钥";
      }
  }
  async keySave(id, value) {
    if (
      ![
        "vision",
        "voice",
        "search",
        "search-zhihu",
        ...Object.keys(TTS).map((k) => "tts-" + k),
      ].includes(id)
    )
      throw Error("未知服务");
    if (value !== "") {
      if (typeof value !== "string" || value.length > 4096)
        throw Error("密钥无效");
      if (!(await this.h.e.safeStorage.isAsyncEncryptionAvailable()))
        throw Error("系统密钥加密不可用");
      this.h.vault["service-" + id] = (
        await this.h.e.safeStorage.encryptStringAsync(value.trim())
      ).toString("base64");
      atomic(this.h.vaultFile, this.h.vault);
    }
    await this.hydrate();
  }
  settings() {
    return {
      schema: SCHEMA,
      values: Object.fromEntries(
        Object.keys(SCHEMA).map((k) => [
          k,
          getByPath(this.h.runtime.config, k),
        ]),
      ),
      secrets: Object.fromEntries(
        ["vision", "voice", "search", "search-zhihu"].map((k) => [
          k,
          !!this.h.vault["service-" + k],
        ]),
      ),
      wechat: false,
      secretErrors: this.secretErrors || {},
    };
  }
  async settingsSave(input) {
    this.h.idle();
    const patch = input.patch || {};
    for (const k of Object.keys(patch))
      if (!(k in SCHEMA)) throw Error("不支持修改字段：" + k);
    for (const [id, k] of [
      ["vision", "vision.baseUrl"],
      ["voice", "voice.baseUrl"],
    ])
      if (
        patch[k] &&
        patch[k] !== getByPath(this.h.runtime.config, k) &&
        this.h.vault["service-" + id] &&
        !input.secrets?.[id]
      )
        throw Error(
          "服务地址改变，请重新填写对应密钥，避免把旧密钥发送到新服务",
        );
    applyConfigPatch(this.h.runtime, patch);
    // 核心重载会恢复磁盘配置；随后重新注入加密凭据及当前模型，避免影子配置覆盖。
    await this.h.configure();
    await this.hydrate();
    this.h.runtime.moments.stopAutoRead();
    this.h.runtime.diary.stop();
    for (const [k, v] of Object.entries(input.secrets || {}))
      await this.keySave(k, v);
    return this.settings();
  }
  async fetchBytes(
    url,
    options = {},
    limit = 16 * 1024 * 1024,
    session = this.voiceSession,
  ) {
    const res = await session.fetch(url, {
      ...options,
      redirect: "error",
      signal: options.signal || AbortSignal.timeout(90000),
    });
    if (!res.ok) throw Error("服务返回 HTTP " + res.status);
    const reader = res.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw Error("服务返回内容过大");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks);
  }
  tts() {
    const id = this.data.ttsProvider || "system";
    return {
      provider: id,
      providers: TTS,
      profiles: this.data.ttsProfiles,
      profile: { ...TTS[id], ...this.data.ttsProfiles[id] },
      hasKey: !!this.h.vault["service-tts-" + id],
    };
  }
  async ttsSave(i) {
    this.h.idle();
    const id = i.provider;
    if (!TTS[id]) throw Error("未知语音厂商");
    const p = {
      model: short(i.model, 160),
      voice: short(i.voice, 160),
      instructions: short(i.instructions || "", 1000),
      chance: Number(i.chance || 0),
      enabled: i.enabled === true,
      timeout: Number(i.timeout || 90),
      baseUrl: TTS[id].baseUrl || "",
      proxyMode: i.proxyMode === "system" ? "system" : "direct",
    };
    if (
      !p.model ||
      !p.voice ||
      !Number.isFinite(p.chance) ||
      p.chance < 0 ||
      p.chance > 1
    )
      throw Error("模型、音色或概率无效");
    if (id === "custom") {
      p.baseUrl = profile({
        id: "tts",
        baseUrl: i.baseUrl,
        model: p.model,
        provider: "custom",
      }).baseUrl;
      const old = this.data.ttsProfiles[id];
      if (
        old &&
        old.baseUrl !== p.baseUrl &&
        this.h.vault["service-tts-custom"] &&
        !i.apiKey
      )
        throw Error("语音接口地址改变，请重新填写密钥");
    }
    if (!Number.isInteger(p.timeout) || p.timeout < 5 || p.timeout > 90)
      throw Error("语音合成超时请设为5–90秒");
    if (id !== "system") await this.keySave("tts-" + id, i.apiKey || "");
    this.data.ttsProvider = id;
    this.data.ttsProfiles[id] = p;
    this.save();
    atomic(path.join(this.h.root, "data", "voice-send.json"), {
      Enabled: p.enabled,
      Private: true,
      Groups: true,
      Chance: p.chance,
      Provider: id,
      Model: p.model,
      Voice: p.voice,
      Instructions: p.instructions,
    });
    return this.tts();
  }
  async synth(text) {
    text = short(text, 1000);
    if (!text) throw Error("请输入试音文本");
    const t = this.tts(),
      p = t.profile;
    let audio;
    if (t.provider === "system") {
      if (!p.voice || /[\x00-\x1f]/.test(p.voice)) throw Error("系统音色无效");
      const dir = fs.mkdtempSync(path.join(this.h.root, "speech-")),
        file = path.join(dir, "preview.wav");
      try {
        await execFile(
          "/usr/bin/say",
          [
            "-v",
            p.voice,
            "--file-format=WAVE",
            "--data-format=LEI16@22050",
            "-o",
            file,
            text,
          ],
          { timeout: 90000, maxBuffer: 65536 },
        );
        audio = fs.readFileSync(file);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } else {
      const key = await this.h.secret("service-tts-" + t.provider);
      if (!key) throw Error("请先保存此厂商密钥");
      let url = p.baseUrl + "/audio/speech",
        headers = {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body = {
          model: p.model,
          voice: p.voice,
          input: p.instructions
            ? p.instructions + "<|endofprompt|>" + text
            : text,
          response_format: "wav",
          sample_rate: 32000,
          stream: false,
        };
      if (t.provider === "breezeblue") {
        url =
          p.baseUrl +
          "/text-to-speech/" +
          encodeURIComponent(p.voice) +
          "?output_format=wav&delivery=sync";
        headers = { "Content-Type": "application/json", "xi-api-key": key };
        body = { text, model_id: p.model, instructions: p.instructions };
      }
      if (t.provider === "minimax") {
        url = p.baseUrl + "/t2a_v2";
        body = {
          model: p.model,
          text,
          stream: false,
          output_format: "hex",
          voice_setting: { voice_id: p.voice, speed: 1, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32000, format: "wav", channel: 1 },
        };
      }
      await this.voiceSession.setProxy({
        mode: p.proxyMode === "system" ? "system" : "direct",
      });
      audio = await this.fetchBytes(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(p.timeout * 1000),
      });
      if (t.provider === "minimax") {
        const j = JSON.parse(audio.toString());
        if (j.base_resp?.status_code)
          throw Error("语音合成失败：" + j.base_resp.status_code);
        if (!/^[a-f0-9]+$/i.test(j.data?.audio || ""))
          throw Error("语音服务未返回音频");
        audio = Buffer.from(j.data.audio, "hex");
      }
    }
    if (
      audio.length < 12 ||
      audio.length > 16 * 1024 * 1024 ||
      audio.subarray(0, 4).toString() !== "RIFF" ||
      audio.subarray(8, 12).toString() !== "WAVE"
    )
      throw Error("音频内容无效");
    return {
      url: "data:audio/wav;base64," + audio.toString("base64"),
      bytes: audio.length,
    };
  }
  async catalog() {
    const t = this.tts(),
      p = t.profile;
    if (t.provider === "system") {
      const r = await execFile("/usr/bin/say", ["-v", "?"], {
        maxBuffer: 1024 * 1024,
      });
      return {
        voices: r.stdout
          .split("\n")
          .filter(Boolean)
          .map((x) => ({ id: x.split(/\s{2,}/)[0], name: x })),
        models: [{ id: "system", name: "macOS" }],
      };
    }
    const key = await this.h.secret("service-tts-" + t.provider);
    if (!key) throw Error("请先保存密钥");
    let endpoint =
      t.provider === "breezeblue"
        ? "/voices"
        : t.provider === "minimax"
          ? "/get_voice"
          : "/audio/voice/list";
    const headers =
      t.provider === "breezeblue"
        ? { "xi-api-key": key }
        : {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          };
    const opts =
      t.provider === "minimax"
        ? {
            method: "POST",
            headers,
            body: JSON.stringify({ voice_type: "all" }),
          }
        : { headers };
    const j = JSON.parse(
      (
        await this.fetchBytes(p.baseUrl + endpoint, opts, 4 * 1024 * 1024)
      ).toString(),
    );
    const v = j.voices ||
      j.results || [
        ...(j.system_voice || []),
        ...(j.voice_cloning || []),
        ...(j.voice_generation || []),
      ];
    let models = [{ id: p.model, name: p.model }];
    if (t.provider === "breezeblue" || t.provider === "siliconflow") {
      const out = JSON.parse(
        (
          await this.fetchBytes(
            p.baseUrl +
              (t.provider === "breezeblue" ? "/models" : "/models?type=audio"),
            { headers },
            4 * 1024 * 1024,
          )
        ).toString(),
      );
      const list = Array.isArray(out) ? out : out.data || [];
      models = list.map((x) => ({
        id: x.model_id || x.id,
        name: x.name || x.id,
      }));
    }
    return {
      voices: v.map((x) => ({
        id: x.voice_id || x.uri || x.id,
        name: x.name || x.voice_name || x.customName || x.voice_id,
      })),
      models,
    };
  }
  inventory(category) {
    const inv = require("../src/services/stickerLibraryLocal").run(
      this.h.root,
      "inventory",
    );
    const selected =
      inv.emotions.find((x) => x.key === category) || inv.emotions[0];
    return {
      ...inv,
      emotions: inv.emotions.map(({ key, label, count }) => ({
        key,
        label,
        count,
      })),
      selected: selected?.key,
      items: (selected?.items || []).slice(0, 200).map((x) => {
        const f = inside(inv.dir, x.path),
          ext = path.extname(f).slice(1).toLowerCase();
        if (fs.statSync(f).size > 8 * 1024 * 1024)
          return { id: x.id, large: true };
        return {
          id: x.id,
          url:
            "data:image/" +
            (ext === "jpg" ? "jpeg" : ext) +
            ";base64," +
            fs.readFileSync(f).toString("base64"),
        };
      }),
    };
  }
  async stickerImport(category) {
    const inv = this.inventory(category);
    if (!inv.selected) throw Error("请选择分类");
    const r = await this.h.e.dialog.showOpenDialog({
      title: "导入表情包",
      filters: [
        { name: "图片", extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
      ],
      properties: ["openFile", "multiSelections"],
    });
    if (r.canceled) return { count: 0 };
    if (r.filePaths.length > stickers.MAX_UPLOAD_FILES)
      throw Error("每次最多导入5张");
    const files = r.filePaths.map((f) => {
      if (fs.statSync(f).size > stickers.MAX_UPLOAD_BYTES)
        throw Error("图片过大");
      return {
        name: path.basename(f),
        data: fs.readFileSync(f).toString("base64"),
      };
    });
    const uploaded = stickers.upload(
      this.h.runtime.config,
      this.h.root,
      inv.selected,
      files,
    );
    this.h.runtime.stickerService.invalidateStatus();
    return { uploaded };
  }
  async stickerDelete(id) {
    const inv = require("../src/services/stickerLibraryLocal").run(
      this.h.root,
      "inventory",
    );
    const it = inv.emotions.flatMap((x) => x.items).find((x) => x.id === id);
    if (!it) throw Error("图片不存在");
    const f = inside(inv.dir, it.path);
    await this.h.e.shell.trashItem(f);
    stickers.invalidateScan(path.dirname(f));
    this.h.runtime.stickerService.invalidateStatus();
    return { ok: true };
  }
  category(i) {
    const cfg = this.h.runtime.config,
      root = stickers.stickerDir(cfg, this.h.root),
      label = stickers.cleanCategoryLabel(i.label);
    if (!label || Object.values(stickers.EMOTIONS).includes(label))
      throw Error("请选择有效的自定义分类名");
    let extra = stickers.readExtraCategories(cfg, this.h.root),
      at = extra.findIndex((x) => x.label === label);
    if (i.operation === "add") {
      if (at >= 0) throw Error("分类已存在");
      stickers.safeDirectory(path.join(root, label));
      extra.push({ label, chance: 0.25 });
    } else if (i.operation === "remove") {
      if (at < 0) throw Error("分类不存在");
      extra.splice(at, 1);
    } else if (i.operation === "rename") {
      const n = stickers.cleanCategoryLabel(i.newLabel);
      if (
        at < 0 ||
        !n ||
        extra.some((x) => x.label === n) ||
        Object.values(stickers.EMOTIONS).includes(n) ||
        fs.existsSync(path.join(root, n))
      )
        throw Error("新分类名无效或已存在");
      fs.renameSync(path.join(root, label), path.join(root, n));
      extra[at].label = n;
    } else throw Error("未知分类操作");
    stickers.writeExtraCategories(cfg, this.h.root, extra);
    this.h.runtime.stickerService.invalidateStatus();
    return { ok: true };
  }
  reminders() {
    return {
      items: this.h.runtime.reminders.list(),
      rules: this.h.runtime.reminders.rules(),
    };
  }
  tick() {
    const service = this.h.runtime.reminders;
    if (!service) return;
    for (const item of service.items) {
      if (
        item.wxid !== "isle-local" ||
        item.status !== "pending" ||
        item.dueAt > Date.now()
      )
        continue;
      const rules = service.rules();
      if (!rules.enabled || rules.remaining === 0) continue;
      if (Date.now() - item.dueAt > 300000) {
        item.status = "expired";
        service.save();
        continue;
      }
      if (!this.h.e.Notification?.isSupported()) continue;
      try {
        new this.h.e.Notification({
          title: "鲸屿提醒",
          body: item.text,
        }).show();
        item.status = "done";
        item.finishedAt = Date.now();
        service.save();
      } catch {
        item.status = "failed";
        item.error = "系统通知不可用";
        service.save();
      }
    }
    const cfg = this.h.runtime.config;
    if (
      cfg.diary.enabled &&
      !this.h.controller &&
      !this.h.probing &&
      !this.generating &&
      Date.now() > (this.nextDiaryAttempt || 0)
    ) {
      const time = require("../src/infra/time"),
        tz = time.resolveTimeZone(cfg),
        p = time.parts(Date.now(), tz),
        clock =
          String(p.hour).padStart(2, "0") +
          ":" +
          String(p.minute).padStart(2, "0"),
        day = time.dayKey(Date.now(), tz);
      if (this.diaryAttemptDay !== day) {
        this.diaryAttemptDay = day;
        this.diaryAttempts = 0;
      }
      if (
        clock >= (cfg.diary.time || "23:00") &&
        this.autoDiaryDay !== day &&
        this.diaryAttempts < 3
      ) {
        this.nextDiaryAttempt = Date.now() + 15 * 60000;
        this.autoDiaryDay = "running";
        void this.diaryGenerate()
          .then((result) => {
            this.autoDiaryDay = result.status === "done" ? day : "";
            if (result.status === "failed") this.diaryAttempts += 1;
          })
          .catch((err) => {
            this.autoDiaryDay = "";
            if (err.code !== "DIARY_BUSY") this.diaryAttempts += 1;
            this.h.runtime.logger.warn(
              "本机定时日记生成失败，请在日记页检查模型和当天素材",
            );
          });
      }
    }
  }
  async diaryGenerate() {
    try {
      this.h.idle();
    } catch (err) {
      err.code = "DIARY_BUSY";
      throw err;
    }
    if (this.h.runtime.llm.isMock) throw Error("请先配置模型");
    const diary = this.h.runtime.diary,
      old = diary.ownerTarget;
    // Mac 工作台的私聊也可生成日记；保留核心生成、落盘、索引与 token 预算逻辑。
    const messages = [...this.h.runtime.store.chatStore.chats.entries()]
      .filter(([key]) => /^web:u:isle-[\w-]+:private$/.test(key))
      .flatMap(([, session]) => session.messages || [])
      .sort((a, b) => Number(a.ts) - Number(b.ts));
    if (!messages.length) {
      diary.state = {
        status: "empty",
        message: "今天还没有本机私聊素材，请先试聊",
        file: "",
      };
      return diary.status();
    }
    const session = { messages };
    diary.ownerTarget = () => ({
      session,
      wxid: "isle-local",
      name: this.h.runtime.config.persona.ownerName || "你",
    });
    const originalPrompt = this.h.runtime.config.persona.customPrompt;
    this.h.runtime.config.persona.customPrompt = composePrompt(
      this.h.state.data.prompts,
      "private",
    );
    this.generating = true;
    this.h.probing = true;
    try {
      diary.stopped = false;
      await diary.generate();
      return diary.status();
    } finally {
      diary.ownerTarget = old;
      diary.stop();
      this.generating = false;
      this.h.probing = false;
      this.h.runtime.config.persona.customPrompt = originalPrompt;
    }
  }
  diaries() {
    const dir = this.h.runtime.diary.dir;
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { recursive: true })
      .filter((x) => String(x).endsWith(".md"))
      .slice(-400)
      .map((file) => ({
        file,
        text: fs
          .readFileSync(inside(dir, path.join(dir, file)), "utf8")
          .slice(0, 100000),
      }));
  }
  async invoke(action, i = {}) {
    switch (action) {
      case "workbench-settings":
        return this.settings();
      case "workbench-save":
        return this.settingsSave(i);
      case "original-list":
        return originals(this.source);
      case "original-restore": {
        this.h.idle();
        const items = originals(this.source);
        this.h.state.data.presets = this.h.state.data.presets.filter(
          (p) => !p.id.startsWith("upstream-persona-"),
        );
        this.h.state.data.presets.push(...items);
        this.h.state.save();
        return this.h.view();
      }
      case "tts-state":
        return this.tts();
      case "tts-save":
        return this.ttsSave(i);
      case "tts-preview":
        return this.synth(i.text);
      case "tts-catalog":
        return this.catalog();
      case "sticker-list":
        return this.inventory(i.category);
      case "sticker-import":
        return this.stickerImport(i.category);
      case "sticker-delete":
        return this.stickerDelete(i.id);
      case "sticker-category":
        return this.category(i);
      case "sticker-presets":
        return {
          copied: await this.h.runtime.stickerService.importPresets({
            manual: true,
          }),
        };
      case "sticker-open": {
        const inv = require("../src/services/stickerLibraryLocal").run(
          this.h.root,
          "inventory",
        );
        await this.h.e.shell.openPath(stickers.safeDirectory(inv.dir));
        return { ok: true };
      }
      case "reminder-list":
        return this.reminders();
      case "reminder-add": {
        this.h.runtime.reminders.add({
          wxid: i.target === "local" ? "isle-local" : short(i.target, 120),
          name: i.target === "local" ? "本机通知" : i.target,
          text: short(i.text, 200),
          at: Number(i.at),
        });
        return this.reminders();
      }
      case "reminder-cancel":
        return this.h.runtime.reminders.cancel(i.id);
      case "diary-list":
        return { status: this.h.runtime.diary.status(), items: this.diaries() };
      case "diary-generate":
        return this.diaryGenerate();
      case "budget":
        return require("../src/services/budget").estimate(
          this.h.runtime.config,
          {
            provider: this.h.runtime.llm.provider,
            model: this.h.runtime.llm.model,
          },
        );
      case "moment-draft": {
        this.h.idle();
        const text = short(i.text, 2000);
        this.data.drafts.unshift({
          id: crypto.randomUUID(),
          text,
          at: Date.now(),
        });
        this.data.drafts = this.data.drafts.slice(0, 100);
        this.save();
        return this.data.drafts;
      }
      case "moment-list":
        return {
          drafts: this.data.drafts,
          snapshot: this.h.runtime.moments.snapshot(),
          publisher: this.h.runtime.momentsPublisher.status(),
        };
      case "moment-delete":
        this.data.drafts = this.data.drafts.filter((x) => x.id !== i.id);
        this.save();
        return { ok: true };
      default:
        throw Error("不支持此操作");
    }
  }
  close() {
    clearInterval(this.timer);
  }
}
module.exports = { Workbench, SCHEMA, TTS };
