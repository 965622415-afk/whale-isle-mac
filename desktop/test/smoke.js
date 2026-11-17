"use strict";
const http = require("node:http");
const assert = require("node:assert/strict");
async function run(host, win) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body);
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
    assert.equal(ui.buttons, 7);
    return {
      ok: true,
      probe,
      chat: { text: chat.text, elapsed: chat.elapsed },
      ui,
      memory: (await host.invoke("memory-list")).length,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
module.exports = { run };
