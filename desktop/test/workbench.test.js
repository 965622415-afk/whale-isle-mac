"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Host } = require("../host");
const { originals } = require("../original-presets");
const source = path.resolve(__dirname, "../..");
test("生成占用写操作时，新增工作台只读查询仍可运行且写操作保持互斥", async () => {
  const { OperationGate } = require("../operations");
  const gate = new OperationGate();
  let finish;
  const chat = gate.run("chat", () => new Promise((r) => (finish = r)));
  for (const name of [
    "sticker-list",
    "tts-state",
    "diary-list",
    "plugin-list",
    "original-list",
    "workbench-settings",
    "memory-detail",
  ])
    assert.equal(await gate.run(name, () => name), name);
  await assert.rejects(
    gate.run("persona-save", () => {}),
    /当前操作/,
  );
  finish();
  await chat;
  assert.equal(await gate.run("persona-save", () => 42), 42);
});
test("可选服务密钥损坏不阻断启动，重填后警告消失", async () => {
  const f = fixture();
  try {
    f.h.vault["service-vision"] = Buffer.from("broken").toString("base64");
    const old = f.h.e.safeStorage.decryptStringAsync;
    f.h.e.safeStorage.decryptStringAsync = async (b) => {
      if (b.toString() === "broken") throw Error("fixture decryption failure");
      return old(b);
    };
    await f.h.ready();
    assert.equal(f.h.runtime.config.vision.apiKey, "");
    assert.ok((await f.h.invoke("workbench-settings")).secretErrors.vision);
    await f.h.invoke("workbench-save", {
      secrets: { vision: "synthetic-repaired-key" },
    });
    assert.equal(f.h.runtime.config.vision.apiKey, "synthetic-repaired-key");
    assert.deepEqual(f.h.workbench.secretErrors, {});
  } finally {
    await f.close();
  }
});
test("日记汇集新对话之前的私聊，排除群聊与演示素材", async () => {
  const f = fixture();
  try {
    await f.h.ready();
    await f.h.invoke("model-save", {
      ...f.h.state.active,
      provider: "ollama",
      baseUrl: "http://127.0.0.1:9999/v1",
    });
    for (const [key, text] of [
      ["web:u:isle-old:private", "old"],
      ["web:u:isle-new:private", "new"],
      ["web:u:isle-demo:private:demo", "demo"],
      ["web:g:isle-group:group", "group"],
    ])
      f.h.runtime.store.appendMessage(key, {
        role: "user",
        text,
        ts: Date.now(),
      });
    await f.h.invoke("chat-new");
    let rows;
    f.h.runtime.diary.generate = async () => {
      rows = f.h.runtime.diary.ownerTarget().session.messages;
      f.h.runtime.diary.state = { status: "done" };
    };
    await f.h.invoke("diary-generate");
    assert.deepEqual(
      rows.map((x) => x.text),
      ["old", "new"],
    );
  } finally {
    await f.close();
  }
});
test("定时日记失败可重试，成功后当天停止，连续失败最多三次", async () => {
  const f = fixture();
  try {
    f.h.runtime.config.diary.enabled = true;
    f.h.runtime.config.diary.time = "00:00";
    let count = 0;
    f.h.workbench.diaryGenerate = async () => {
      count++;
      if (count === 1) throw Error("fixture");
      return { status: "done" };
    };
    f.h.workbench.tick();
    await new Promise(setImmediate);
    assert.equal(f.h.workbench.autoDiaryDay, "");
    f.h.workbench.nextDiaryAttempt = 0;
    f.h.workbench.tick();
    await new Promise(setImmediate);
    assert.equal(count, 2);
    f.h.workbench.nextDiaryAttempt = 0;
    f.h.workbench.tick();
    assert.equal(count, 2);
    f.h.workbench.autoDiaryDay = "";
    f.h.workbench.diaryAttempts = 0;
    count = 0;
    f.h.workbench.diaryGenerate = async () => {
      count++;
      throw Error("fixture");
    };
    for (let i = 0; i < 4; i++) {
      f.h.workbench.nextDiaryAttempt = 0;
      f.h.workbench.tick();
      await new Promise(setImmediate);
    }
    assert.equal(count, 3);
  } finally {
    await f.close();
  }
});
function fixture() {
  const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "isle-parity-")),
    ),
    notifications = [];
  let selected = [];
  const session = {
    setProxy: async () => {},
    closeAllConnections: async () => {},
    fetch: async () => {
      throw Error("unexpected network");
    },
  };
  class Notification {
    static isSupported() {
      return true;
    }
    constructor(o) {
      this.o = o;
    }
    show() {
      notifications.push(this.o);
    }
  }
  const h = new Host({
    root,
    source,
    electron: {
      session: { fromPartition: () => session },
      net: {},
      safeStorage: {
        isAsyncEncryptionAvailable: async () => true,
        encryptStringAsync: async (x) => Buffer.from("enc:" + x),
        decryptStringAsync: async (x) => ({ result: x.toString().slice(4) }),
      },
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: selected }),
        showMessageBox: async () => ({ response: 1 }),
      },
      shell: { trashItem: async (f) => fs.renameSync(f, f + ".trash") },
      Notification,
    },
  });
  return {
    h,
    root,
    notifications,
    session,
    choose: (f) => (selected = f),
    close: async () => {
      await h.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
test("七份原文逐字保留，旧版表达设置也完整进入生效提示词", () => {
  const items = originals(source);
  assert.equal(items.length, 7);
  for (const p of items) {
    const raw = JSON.parse(
      fs.readFileSync(path.join(source, p.provenance.path)),
    );
    assert.equal(p.prompts.role, raw.customPrompt);
    assert.equal(
      p.provenance.sha256,
      crypto.createHash("sha256").update(raw.customPrompt).digest("hex"),
    );
    assert.ok(p.prompts.style.includes(raw.text));
    assert.ok(p.persona.personality);
    assert.ok(p.persona.background);
  }
});
test("升级导入补齐空白字段和表达规则，保留用户修改与自建预设", async () => {
  const f = fixture();
  try {
    const p = f.h.state.data.presets.find((x) => x.id.endsWith("zhainan"));
    p.persona.personality = "用户自己修改的性格";
    f.h.state.data.prompts = { ...p.prompts, style: "" };
    f.h.runtime.config.persona.personality = "";
    require("../original-presets").installOriginals(f.h, source);
    assert.equal(p.persona.personality, "用户自己修改的性格");
    assert.ok(f.h.state.data.prompts.style.includes("旧版表达"));
    assert.ok(f.h.runtime.config.persona.personality);
    assert.equal(f.h.state.data.presets.length, 7);
  } finally {
    await f.close();
  }
});
test("设置写入后重载仍保留当前模型，服务密钥只存加密文件", async () => {
  const f = fixture();
  try {
    await f.h.ready();
    await f.h.invoke("model-save", {
      ...f.h.state.active,
      apiKey: "synthetic-model-value",
    });
    await f.h.invoke("workbench-save", {
      patch: { "care.everyMinutes": 120, "features.stickers": true },
      secrets: { vision: "synthetic-vision-value" },
    });
    assert.equal(f.h.runtime.config.care.everyMinutes, 120);
    assert.equal(f.h.runtime.llm.apiKey, "synthetic-model-value");
    assert.equal(f.h.runtime.config.vision.apiKey, "synthetic-vision-value");
    assert.ok(
      !fs
        .readFileSync(path.join(f.root, "data/config.json"), "utf8")
        .includes("synthetic-vision-value"),
    );
    await assert.rejects(
      f.h.invoke("workbench-save", { patch: { "server.host": "0.0.0.0" } }),
      /不支持/,
    );
    await assert.rejects(
      f.h.invoke("workbench-save", { patch: { "care.everyMinutes": -1 } }),
    );
    await assert.rejects(
      f.h.invoke("workbench-save", {
        patch: { "vision.baseUrl": "https://elsewhere.example/v1" },
      }),
      /重新填写/,
    );
  } finally {
    await f.close();
  }
});
test("图库导入真实PNG并按分类读取，目录穿越删除被拒绝", async () => {
  const f = fixture();
  try {
    await f.h.ready();
    await f.h.invoke("workbench-save", {
      patch: { "features.stickers": true },
    });
    await f.h.runtime.stickerService.startMaintenanceNow();
    const png = path.join(f.root, "sample.png");
    fs.writeFileSync(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3u0AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    f.choose([png]);
    await f.h.invoke("sticker-import", {});
    const inv = await f.h.invoke("sticker-list");
    assert.ok(inv.items.length > 0);
    assert.ok(inv.items[0].url.startsWith("data:image/"));
    await assert.rejects(
      f.h.invoke("sticker-delete", { id: "../../isle.json" }),
      /不存在/,
    );
    await f.h.invoke("sticker-category", { operation: "add", label: "猫猫" });
    await f.h.invoke("sticker-category", {
      operation: "rename",
      label: "猫猫",
      newLabel: "小猫",
    });
    assert.ok(
      (await f.h.invoke("sticker-list")).emotions.some(
        (x) => x.label === "小猫",
      ),
    );
  } finally {
    await f.close();
  }
});
test("到期本机提醒触发通知，微信提醒保持待发，过期任务不补发", async () => {
  const f = fixture();
  try {
    const s = f.h.runtime.reminders;
    const a = s.add({
      wxid: "isle-local",
      text: "本机测试",
      at: Date.now() + 1000,
    });
    const b = s.add({
      wxid: "filehelper",
      text: "微信测试",
      at: Date.now() + 1000,
    });
    s.items.find((x) => x.id === a.id).dueAt = Date.now() - 10;
    s.items.find((x) => x.id === b.id).dueAt = Date.now() - 10;
    f.h.workbench.tick();
    assert.equal(f.notifications.length, 1);
    assert.equal(s.items.find((x) => x.id === a.id).status, "done");
    assert.equal(s.items.find((x) => x.id === b.id).status, "pending");
    const c = s.add({
      wxid: "isle-local",
      text: "过期测试",
      at: Date.now() + 1000,
    });
    s.items.find((x) => x.id === c.id).dueAt = Date.now() - 360000;
    f.h.workbench.tick();
    assert.equal(s.items.find((x) => x.id === c.id).status, "expired");
    assert.equal(f.notifications.length, 1);
  } finally {
    await f.close();
  }
});
test("语音设置厂商独立保存，模型目录和音频均走限定接口", async () => {
  const f = fixture();
  try {
    await f.h.ready();
    await f.h.invoke("tts-save", {
      provider: "minimax",
      model: "speech-fixture",
      voice: "fixture",
      apiKey: "synthetic-speech-value",
      chance: 0.25,
      timeout: 20,
    });
    const wav = Buffer.alloc(44);
    wav.write("RIFF");
    wav.write("WAVE", 8);
    f.session.fetch = async (url, opts) => {
      assert.ok(url.endsWith("/t2a_v2"));
      assert.equal(JSON.parse(opts.body).voice_setting.voice_id, "fixture");
      return new Response(
        JSON.stringify({
          base_resp: { status_code: 0 },
          data: { audio: wav.toString("hex") },
        }),
      );
    };
    const r = await f.h.invoke("tts-preview", { text: "测试语音" });
    assert.equal(r.bytes, 44);
    assert.ok(r.url.startsWith("data:audio/wav"));
    assert.ok(
      !fs
        .readFileSync(path.join(f.root, "workbench.json"), "utf8")
        .includes("synthetic-speech-value"),
    );
    await f.h.invoke("tts-save", {
      provider: "system",
      model: "system",
      voice: "Tingting",
    });
    assert.equal(f.h.workbench.data.ttsProfiles.minimax.voice, "fixture");
  } finally {
    await f.close();
  }
});
test("ZIP解析拒绝任意文件和损坏目录", () => {
  const { readZip } = require("../plugins");
  assert.throws(() => readZip(Buffer.from("not-a-zip")));
  const b = Buffer.alloc(22);
  b.writeUInt32LE(0x06054b50);
  b.writeUInt16LE(2, 10);
  assert.throws(() => readZip(b));
});
