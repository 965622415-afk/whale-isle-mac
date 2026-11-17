"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  zlib = require("node:zlib");
const { atomic, preset } = require("./state");
const { portableFields } = require("../src/persona/portable");
const ID = /^[a-z][a-z0-9-]{0,47}$/;
// 只读取原版两文件格式；不解压到文件系统，限制解压后大小以抵御 ZIP 炸弹。
function readZip(buf) {
  if (buf.length > 16 * 1024 * 1024) throw Error("插件包超过16MB");
  let end = -1;
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 65557); p--)
    if (buf.readUInt32LE(p) === 0x06054b50) {
      end = p;
      break;
    }
  if (
    end < 0 ||
    buf.readUInt16LE(end + 10) !== 2 ||
    buf.readUInt16LE(end + 4) !== 0
  )
    throw Error("ZIP必须在根目录包含两个文件");
  let pos = buf.readUInt32LE(end + 16);
  const files = {};
  for (let n = 0; n < 2; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50)
      throw Error("ZIP目录无效");
    const flags = buf.readUInt16LE(pos + 8),
      method = buf.readUInt16LE(pos + 10),
      compressed = buf.readUInt32LE(pos + 20),
      size = buf.readUInt32LE(pos + 24),
      len = buf.readUInt16LE(pos + 28),
      extra = buf.readUInt16LE(pos + 30),
      comment = buf.readUInt16LE(pos + 32),
      attr = buf.readUInt32LE(pos + 38),
      local = buf.readUInt32LE(pos + 42),
      name = buf.subarray(pos + 46, pos + 46 + len).toString("utf8");
    if (
      flags & 1 ||
      !["plugin.json", "plugin.js", "plugin.wasm", "persona.json"].includes(
        name,
      ) ||
      files[name] ||
      ((attr >>> 16) & 0xf000) === 0xa000 ||
      size > 8 * 1024 * 1024 ||
      compressed > 16 * 1024 * 1024 ||
      local + 30 > buf.length ||
      buf.readUInt32LE(local) !== 0x04034b50
    )
      throw Error("插件文件或大小无效");
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressed > buf.length) throw Error("ZIP已损坏");
    const data = buf.subarray(start, start + compressed);
    const value =
      method === 0
        ? data
        : method === 8
          ? zlib.inflateRawSync(data, { maxOutputLength: 8 * 1024 * 1024 })
          : null;
    if (!value || value.length !== size) throw Error("ZIP压缩格式无效");
    files[name] = value;
    pos += 46 + len + extra + comment;
  }
  if (!files["plugin.json"] || files["plugin.json"].length > 8192)
    throw Error("缺少插件清单");
  return files;
}
class Plugins {
  constructor(host, workbench) {
    this.h = host;
    this.w = workbench;
    this.root = path.join(host.root, "data", "plugins");
    fs.mkdirSync(this.root, { recursive: true });
    this.market = [];
  }
  list() {
    return fs
      .readdirSync(this.root)
      .filter((n) => n.endsWith(".isle-plugin.json"))
      .flatMap((n) => {
        try {
          const info = JSON.parse(
            fs.readFileSync(path.join(this.root, n), "utf8"),
          );
          if (!ID.test(info.id)) return [];
          return [
            {
              ...info,
              enabled: fs.existsSync(
                path.join(this.root, info.id + ".enabled"),
              ),
              settings: JSON.parse(
                fs.readFileSync(
                  path.join(this.root, info.id + ".flow-settings.json"),
                  "utf8",
                ),
              ),
            },
          ];
        } catch {
          return [];
        }
      });
  }
  async catalog() {
    const all = [];
    for (const v of [
      "index.json",
      "index-v2.json",
      "index-v3.json",
      "index-v4.json",
      "index-personas.json",
    ]) {
      const bytes = await this.w.fetchBytes(
        "https://raw.githubusercontent.com/Banan1cee/whale-girl-plugins/main/" +
          v,
        {},
        4 * 1024 * 1024,
        this.h.network,
      );
      const j = JSON.parse(bytes.toString());
      if (!Array.isArray(j)) throw Error("市场清单格式无效");
      all.push(...j);
    }
    this.market = all.map((x) =>
      Object.fromEntries(
        Object.entries(x).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]),
      ),
    );
    return this.market;
  }
  async install(bytes) {
    const files = readZip(bytes),
      raw = JSON.parse(files["plugin.json"].toString()),
      m = Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [
          k[0].toLowerCase() + k.slice(1),
          v,
        ]),
      );
    m.kind ||= "tool";
    m.api ||= 1;
    if (
      !ID.test(m.id) ||
      !m.name ||
      ![1, 2, 3, 4].includes(m.api) ||
      !["tool", "message", "persona"].includes(m.kind)
    )
      throw Error("插件清单无效");
    const previous = this.list().find((x) => x.id === m.id);
    if (previous && previous.author !== m.author)
      throw Error("同ID插件作者已改变，拒绝覆盖");
    if (m.kind === "persona") {
      if (!files["persona.json"]) throw Error("缺少persona.json");
      const p = portableFields(JSON.parse(files["persona.json"].toString()), {
        local: true,
      });
      const item = preset({
        schemaVersion: 1,
        kind: "whale-isle-persona",
        name: m.name,
        persona: { ...p, name: p.personaName || m.name },
        prompts: { role: p.customPrompt || "" },
      });
      item.id = "market-" + m.id;
      this.h.state.data.presets = this.h.state.data.presets
        .filter((x) => x.id !== item.id)
        .concat(item);
      this.h.state.save();
      return { name: m.name, persona: true };
    }
    let flow;
    if (m.api === 4) {
      if (
        !files["plugin.js"] ||
        !Array.isArray(m.hooks) ||
        !m.hooks.length ||
        m.hooks.some(
          (x) =>
            !require("../src/services/javascriptPlugins").HOOKS.includes(x),
        ) ||
        JSON.stringify(m.permissions) !== JSON.stringify(["system.full"])
      )
        throw Error("JavaScript插件清单无效");
      flow = {
        id: m.id,
        api: 4,
        kind: m.kind,
        hooks: m.hooks,
        permissions: m.permissions,
        executionTimeoutMs: m.executionTimeoutMs || 30000,
        intervalSeconds: m.intervalSeconds || 60,
        javascript: new TextDecoder("utf-8", { fatal: true }).decode(
          files["plugin.js"],
        ),
      };
    } else {
      const wasm = files["plugin.wasm"];
      if (
        !wasm ||
        wasm.length > 512 * 1024 ||
        wasm.subarray(0, 8).toString("hex") !== "0061736d01000000"
      )
        throw Error("WebAssembly模块无效");
      flow = {
        id: m.id,
        api: m.api,
        hooks: m.hooks || [],
        permissions: m.permissions || [],
        wasm: wasm.toString("base64"),
      };
      if (
        m.api === 3 &&
        (flow.hooks.some(
          (x) => !require("../src/services/messagePlugins").HOOKS.includes(x),
        ) ||
          flow.permissions.some(
            (x) => !["chat.history", "model.prompt"].includes(x),
          ))
      )
        throw Error("消息插件权限无效");
    }
    const answer = await this.h.e.dialog.showMessageBox({
      type: "question",
      buttons: ["取消", "安装（保持停用）"],
      defaultId: 0,
      cancelId: 0,
      message: "安装 " + m.name + "？",
      detail:
        "作者：" +
        (m.author || "未提供") +
        "\n版本：" +
        (m.version || "未提供") +
        "\n" +
        (m.api === 4
          ? "此插件请求完整系统权限，启用前会再次确认。"
          : "安装后需在插件卡片中启用。") +
        "\n第三方插件是否兼容macOS取决于插件本身。",
    });
    if (answer.response !== 1) return { canceled: true };
    for (const ext of [".enabled", ".flow-grant.json"])
      fs.rmSync(path.join(this.root, m.id + ext), { force: true });
    atomic(path.join(this.root, m.id + ".flow.json"), flow);
    atomic(path.join(this.root, m.id + ".isle-plugin.json"), m);
    const st = path.join(this.root, m.id + ".flow-settings.json");
    if (!fs.existsSync(st)) atomic(st, {});
    await this.h.runtime.bot.javascriptPlugins.reconcile();
    return { name: m.name };
  }
  async toggle(id, on) {
    if (!ID.test(id)) throw Error("插件ID无效");
    const item = this.list().find((x) => x.id === id);
    if (!item) throw Error("插件不存在");
    const enabled = path.join(this.root, id + ".enabled"),
      grant = path.join(this.root, id + ".flow-grant.json");
    if (!on) {
      fs.rmSync(enabled, { force: true });
      fs.rmSync(grant, { force: true });
      await this.h.runtime.bot.javascriptPlugins.reconcile();
      return this.list();
    }
    if (item.api === 4 && !this.h.runtime.config.features.javascriptPlugins)
      throw Error("请先开启JavaScript插件总开关");
    const r = await this.h.e.dialog.showMessageBox({
      type: "warning",
      buttons: ["取消", "授权并启用"],
      defaultId: 0,
      cancelId: 0,
      message: "启用 " + item.name + "？",
      detail:
        item.api === 4
          ? "此插件以你的Mac用户权限运行，可读取文件、访问网络、执行系统命令。仅启用你信任的代码。"
          : "权限：" + (item.permissions || []).join("、"),
    });
    if (r.response !== 1) return this.list();
    const bytes = fs.readFileSync(path.join(this.root, id + ".flow.json")),
      flow = JSON.parse(bytes);
    atomic(grant, {
      enabled: true,
      fullAccess: item.api === 4,
      hash: crypto
        .createHash("sha256")
        .update(item.api === 3 ? JSON.stringify(flow) : bytes)
        .digest("hex"),
      settings: item.settings,
    });
    fs.writeFileSync(enabled, "1", { mode: 0o600 });
    await this.h.runtime.bot.javascriptPlugins.reconcile();
    return this.list();
  }
  async invoke(action, i = {}) {
    switch (action) {
      case "plugin-list":
        return {
          items: this.list(),
          javascriptEnabled:
            this.h.runtime.config.features.javascriptPlugins === true,
        };
      case "plugin-catalog":
        return this.catalog();
      case "plugin-download": {
        const item = this.market.find((x) => x.id === i.id);
        if (!item) throw Error("请先刷新市场");
        const u = new URL(item.download);
        if (
          u.protocol !== "https:" ||
          u.hostname !== "raw.githubusercontent.com" ||
          !u.pathname.startsWith("/Banan1cee/whale-girl-plugins/")
        )
          throw Error("下载地址不受支持");
        const bytes = await this.w.fetchBytes(
          u.href,
          {},
          16 * 1024 * 1024,
          this.h.network,
        );
        if (
          crypto.createHash("sha256").update(bytes).digest("hex") !==
          item.sha256?.toLowerCase()
        )
          throw Error("插件校验和不匹配");
        return this.install(bytes);
      }
      case "plugin-import": {
        const r = await this.h.e.dialog.showOpenDialog({
          title: "安装原版插件ZIP",
          properties: ["openFile"],
          filters: [{ name: "插件包", extensions: ["zip"] }],
        });
        if (r.canceled) return { canceled: true };
        if (fs.statSync(r.filePaths[0]).size > 16 * 1024 * 1024)
          throw Error("插件包过大");
        return this.install(fs.readFileSync(r.filePaths[0]));
      }
      case "plugin-toggle":
        return this.toggle(i.id, i.enabled === true);
      case "plugin-settings": {
        if (!ID.test(i.id) || !this.list().some((x) => x.id === i.id))
          throw Error("插件不存在");
        const s = JSON.parse(i.settings);
        if (
          !s ||
          typeof s !== "object" ||
          Array.isArray(s) ||
          Buffer.byteLength(JSON.stringify(s)) > 65536
        )
          throw Error("设置需要JSON对象，最大64KB");
        atomic(path.join(this.root, i.id + ".flow-settings.json"), s);
        const g = path.join(this.root, i.id + ".flow-grant.json");
        if (fs.existsSync(g)) {
          const v = JSON.parse(fs.readFileSync(g));
          v.settings = s;
          atomic(g, v);
        }
        await this.h.runtime.bot.javascriptPlugins.reconcile();
        return { ok: true };
      }
      case "plugin-run": {
        const p = this.list().find((x) => x.id === i.id);
        if (!p?.enabled) throw Error("请先启用插件");
        if (p.api === 4) {
          this.h.idle();
          return this.h.runtime.bot.javascriptPlugins.runTool(p.id, i.input);
        }
        if (p.api === 3) throw Error("消息插件在试聊中运行");
        let input = i.input || "";
        if (p.hostAction) {
          if (p.hostAction !== "chat.summary") throw Error("不支持的宿主操作");
          this.h.idle();
          if (this.h.runtime.llm.isMock) throw Error("请先配置模型");
          const answer = await this.h.e.dialog.showMessageBox({
            type: "question",
            buttons: ["取消", "允许一次"],
            defaultId: 0,
            cancelId: 0,
            message: "允许生成聊天汇总？",
            detail:
              "本机所选日期的聊天片段会发送给当前模型服务商，插件只收到汇总结果。",
          });
          if (answer.response !== 1) return { canceled: true };
          this.h.probing = true;
          try {
            await this.h.runtime.digest.generate(
              input === "yesterday" ? "yesterday" : "today",
            );
            const d = this.h.runtime.digest.status();
            if (d.status !== "done") throw Error(d.message);
            input = d.text;
          } finally {
            this.h.probing = false;
          }
        }
        const f = JSON.parse(
          fs.readFileSync(path.join(this.root, p.id + ".flow.json")),
        );
        return require("./legacy-plugin").runLegacy(f.wasm, p.api, input);
      }
      case "plugin-delete": {
        await this.toggle(i.id, false);
        for (const ext of [
          ".flow.json",
          ".isle-plugin.json",
          ".flow-settings.json",
        ])
          fs.rmSync(path.join(this.root, i.id + ext), { force: true });
        return { ok: true };
      }
      default:
        throw Error("未知插件操作");
    }
  }
}
module.exports = { Plugins, readZip };
