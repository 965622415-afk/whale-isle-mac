"use strict";
const http = require("node:http");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
async function run(host, win) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body);
      if (req.url.endsWith("/audio/speech")) {
        const wav = Buffer.alloc(44);
        wav.write("RIFF");
        wav.write("WAVE", 8);
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(wav);
        return;
      }
      if (p.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          "data: " +
            JSON.stringify({
              choices: [
                { delta: { content: "本机模型测试成功" }, finish_reason: null },
              ],
            }) +
            "\n\n",
        );
        res.end("data: [DONE]\n\n");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 1,
              total_tokens: 11,
            },
          }),
        );
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await host.invoke("model-save", {
      id: "smoke",
      name: "本机测试服务",
      provider: "ollama",
      baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
      model: "fixture",
      proxyMode: "direct",
      timeout: 10,
      temperature: 0.5,
    });
    const probe = await host.invoke("probe");
    assert.equal(probe.ok, true);
    const chat = await host.invoke("chat", { text: "请回复测试成功" });
    assert.ok(chat.text.includes("本机模型测试成功"));
    await host.invoke("prompts-save", {
      role: "你是鲸屿的测试伙伴",
      private: "测试私聊专属规则",
    });
    await host.invoke("preset-save", { name: "smoke preset" });
    if (win.webContents.isLoading())
      await new Promise((resolve) =>
        win.webContents.once("did-finish-load", resolve),
      );
    const ui = await win.webContents.executeJavaScript(
      `(async()=>{const s=await window.isle.invoke('state');return {title:document.title,buttons:document.querySelectorAll('nav button').length,ok:s.ok,model:s.value.profiles.find(p=>p.id==='smoke').model};})()`,
    );
    assert.equal(ui.ok, true);
    assert.equal(ui.model, "fixture");
    assert.equal(ui.buttons, 15);
    const originals = await host.invoke("original-list");
    assert.equal(originals.length, 7);
    await host.invoke("preset-apply", {
      id: originals.find((x) => x.id.endsWith("zhainan")).id,
    });
    const prompt = await host.invoke("prompt-preview", { mode: "private" });
    assert.ok(
      prompt.prompt.includes(
        originals.find((x) => x.id.endsWith("zhainan")).prompts.role,
      ),
    );
    assert.ok(prompt.prompt.includes("旧版表达设置"));
    await host.invoke("workbench-save", {
      patch: {
        "features.stickers": true,
        "features.javascriptPlugins": true,
        "care.everyMinutes": 120,
      },
    });
    await host.runtime.stickerService.startMaintenanceNow();
    const inventory = await host.invoke("sticker-list");
    assert.ok(inventory.emotions.length >= 3);
    const views = await win.webContents.executeJavaScript(
      `(async()=>{const checked=[];for(const name of Object.keys(workPages)){page=name;await workPages[name]();if(!document.querySelector('#content').textContent.trim())throw Error('empty '+name);checked.push(name)}return checked})()`,
    );
    assert.equal(views.length, 8);
    const pluginRoot = path.join(host.root, "data", "plugins");
    fs.mkdirSync(pluginRoot, { recursive: true });
    const flow = {
      id: "smoke-tool",
      api: 4,
      kind: "tool",
      hooks: ["tool.run"],
      permissions: ["system.full"],
      javascript:
        "exports.run = async ctx => ({text:'fixture-plugin-ok',state:{count:1}});",
    };
    const flowBytes = Buffer.from(JSON.stringify(flow));
    fs.writeFileSync(path.join(pluginRoot, "smoke-tool.flow.json"), flowBytes);
    fs.writeFileSync(path.join(pluginRoot, "smoke-tool.enabled"), "1");
    fs.writeFileSync(
      path.join(pluginRoot, "smoke-tool.flow-grant.json"),
      JSON.stringify({
        enabled: true,
        fullAccess: true,
        hash: crypto.createHash("sha256").update(flowBytes).digest("hex"),
        settings: {},
      }),
    );
    const plugin = await host.runtime.bot.javascriptPlugins.runTool(
      "smoke-tool",
      {},
    );
    assert.equal(plugin.text, "fixture-plugin-ok");
    await host.invoke("tts-save", {
      provider: "custom",
      baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
      model: "fixture",
      voice: "fixture",
      apiKey: "synthetic-fixture-only",
      chance: 0,
      timeout: 10,
    });
    const speech = await host.invoke("tts-preview", { text: "测试" });
    assert.equal(speech.bytes, 44);
    const diary = await host.invoke("diary-generate");
    assert.equal(diary.status, "done");
    return {
      ok: true,
      probe,
      chat: { text: chat.text, elapsed: chat.elapsed },
      ui,
      views,
      plugin: plugin.text,
      speechBytes: speech.bytes,
      diary: diary.status,
      memory: (await host.invoke("memory-list")).length,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
module.exports = { run };
