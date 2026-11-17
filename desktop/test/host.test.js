"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Host } = require("../host");
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "isle-host-"));
  const electron = {
    session: {
      fromPartition: () => ({
        setProxy: async () => {},
        closeAllConnections: async () => {},
      }),
    },
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (x) => Buffer.from("encrypted:" + x),
      decryptStringAsync: async (x) => ({ result: x.toString().slice(10) }),
    },
    net: {},
    dialog: {},
    shell: {},
  };
  return {
    root,
    host: new Host({
      root,
      source: path.resolve(__dirname, "../.."),
      electron,
    }),
  };
}
test("密钥不进入配置、预设和界面状态，换服务地址须重填", async () => {
  const { root, host } = setup();
  try {
    await host.ready();
    const p = host.state.active;
    const saved = await host.invoke("model-save", {
      ...p,
      apiKey: "synthetic-test-value",
    });
    assert.equal(saved.hasKey, true);
    assert.equal(host.runtime.llm.apiKey, "synthetic-test-value");
    await host.invoke("model-save", {
      ...host.state.data.profiles.find((p) => p.id === "openai"),
      apiKey: "synthetic-other-value",
    });
    assert.equal(host.runtime.llm.baseUrl, "https://api.openai.com/v1");
    assert.equal(host.runtime.llm.apiKey, "synthetic-other-value");
    await host.invoke("model-select", { id: p.id });
    assert.ok(!JSON.stringify(saved).includes("synthetic-test-value"));
    assert.ok(
      !fs
        .readFileSync(path.join(root, "isle.json"), "utf8")
        .includes("synthetic-test-value"),
    );
    assert.ok(
      !fs
        .readFileSync(path.join(root, "data/config.json"), "utf8")
        .includes("synthetic-test-value"),
    );
    await assert.rejects(
      host.invoke("model-save", {
        ...p,
        baseUrl: "https://another.example.com/v1",
      }),
      /重新填写/,
    );
    await host.invoke("key-clear", { id: p.id });
    await assert.rejects(host.invoke("probe"), /密钥/);
    await assert.rejects(host.invoke("chat", { text: "hello" }), /密钥/);
  } finally {
    await host.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("演示试聊持久化会话，提示词按场景切换", async () => {
  const { root, host } = setup();
  try {
    await host.ready();
    await host.invoke("prompts-save", {
      role: "你是测试伙伴",
      private: "只在私聊生效",
      group: "只在群聊生效",
    });
    const prompt = await host.invoke("prompt-preview", { mode: "private" });
    assert.ok(prompt.prompt.includes("只在私聊生效"));
    assert.ok(!prompt.prompt.includes("只在群聊生效"));
    const r = await host.invoke("chat", { text: "你好", demo: true });
    assert.equal(r.demo, true);
    assert.ok(r.text.length);
    assert.equal(
      (await host.invoke("chat-history", { demo: false })).length,
      0,
    );
    assert.ok((await host.invoke("chat-history", { demo: true })).length >= 2);
    const sessions = await host.invoke("memory-list");
    assert.ok(sessions.some((x) => x.messageCount >= 2));
    await host.invoke("preset-save", { name: "单测预设" });
    assert.equal(host.state.data.presets.length, 1);
  } finally {
    await host.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
