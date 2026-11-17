"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Harness } = require("../harness");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "isle-sdk-"));
  const h = new Harness(
    { root, state: { data: { prompts: { role: "fixture persona" } } }, e: {} },
    {
      resolveInstallation: () => ({
        exe: process.execPath,
        args: [path.join(__dirname, "harness-fixture.cjs")],
      }),
    },
  );
  return {
    h,
    root,
    close: async () => {
      await h.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("fixture timed out");
}
test("SDK握手与任务结果来自协议事件，历史持久化且不保存模型Key", async () => {
  const f = fixture();
  try {
    const check = await f.h.test();
    assert.equal(check.lastTest.ok, true);
    f.h.run({ text: "执行测试" });
    await f.h.running;
    const t = f.h.data.tasks[0];
    assert.equal(t.status, "completed");
    assert.equal(t.result, "测试完成");
    assert.ok(fs.existsSync(path.join(f.root, "harness.json")));
    const restored = new Harness({ root: f.root });
    assert.equal(restored.data.tasks[0].result, "测试完成");
    assert.equal(JSON.stringify(restored.data).includes("apiKey"), false);
  } finally {
    await f.close();
  }
});
test("审批不会自动放行，必须匹配待决请求并显式批准一次", async () => {
  const f = fixture();
  try {
    f.h.run({ text: "APPROVAL" });
    await until(() => f.h.questions.size === 1);
    assert.equal(f.h.data.tasks[0].status, "waiting");
    assert.throws(
      () => f.h.answer({ id: "stale", outcome: "allowed-once" }),
      /取消|回答/,
    );
    const q = f.h.view().pending[0];
    assert.equal("wireId" in q, false);
    f.h.answer({ id: q.id, outcome: "allowed-once" });
    await f.h.running;
    assert.equal(f.h.data.tasks[0].status, "completed");
    assert.equal(f.h.questions.size, 0);
  } finally {
    await f.close();
  }
});
test("停止等待中的任务不会标记成功，重启不自动重发", async () => {
  const f = fixture();
  try {
    f.h.run({ text: "BLOCK" });
    await until(() => f.h.data.tasks[0].status === "running");
    await f.h.stop();
    await f.h.running;
    assert.equal(f.h.data.tasks[0].status, "stopped");
    f.h.data.tasks[0].status = "running";
    f.h.save();
    const restored = new Harness({ root: f.root });
    assert.equal(restored.data.tasks[0].status, "interrupted");
    assert.equal(restored.child, null);
  } finally {
    await f.close();
  }
});
test("单任务互斥与配置校验，任务运行时不允许换目录或路由", async () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.h.configure({ provider: "invalid", model: "fixture", timeout: 20 }),
      /请选择/,
    );
    f.h.run({ text: "BLOCK" });
    assert.throws(() => f.h.run({ text: "第二个" }), /正在运行/);
    assert.throws(
      () =>
        f.h.configure({ provider: "openai", model: "fixture", timeout: 20 }),
      /正在运行/,
    );
    await f.h.stop();
    await f.h.running;
  } finally {
    await f.close();
  }
});
