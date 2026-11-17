"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { atomic, composePrompt } = require("./state");
const { redactSecrets } = require("../src/infra/redact");
const ACTIVE = new Set(["starting", "running", "waiting"]);
function text(v, max) {
  if (typeof v !== "string" || v.length > max || v.includes("\0"))
    throw Error("输入格式或长度无效");
  return v.trim();
}
function installation(app) {
  const exe = path.join(app, "Contents", "MacOS", "DeepSeek Harness"),
    entry = path.join(
      app,
      "Contents",
      "Resources",
      "app.asar",
      "dsh",
      "node_modules",
      "@deepseek-ai",
      "dsh",
      "lib",
      "bin.js",
    );
  if (
    !app.endsWith(".app") ||
    !fs.existsSync(exe) ||
    !fs.existsSync(path.join(app, "Contents", "Resources", "app.asar"))
  )
    throw Error("未找到已安装的 DeepSeek Harness.app，请选择正确应用");
  return { exe, args: [entry, "--profile", "sdk"] };
}
class Harness {
  constructor(
    host,
    { spawnProcess = spawn, resolveInstallation = installation } = {},
  ) {
    this.h = host;
    this.spawn = spawnProcess;
    this.resolveInstallation = resolveInstallation;
    this.file = path.join(host.root, "harness.json");
    this.data = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : {
          config: {
            appPath: "/Applications/DeepSeek Harness.app",
            provider: "openai",
            model: "gpt-5-mini",
            workspace: path.join(host.root, "tasks"),
            reasoningEffort: "",
            timeout: 600,
            usePersona: false,
          },
          tasks: [],
        };
    // 上次进程结束时未完成的任务不自动重发，以免重复执行文件操作。
    for (const t of this.data.tasks)
      if (ACTIVE.has(t.status)) {
        t.status = "interrupted";
        t.error = "上次连接已结束；未自动重试，检查已有结果后可新建任务。";
      }
    this.pending = new Map();
    this.questions = new Map();
    this.nextId = 0;
    this.child = null;
    this.connection = "idle";
    this.sequence = 0;
  }
  save() {
    atomic(this.file, this.data);
  }
  view() {
    return {
      config: this.data.config,
      tasks: this.data.tasks,
      connection: this.connection,
      lastTest: this.lastTest || null,
      pending: [...this.questions.values()].map(({ wireId, ...q }) => q),
      installed: fs.existsSync(
        path.join(
          this.data.config.appPath,
          "Contents",
          "Resources",
          "app.asar",
        ),
      ),
    };
  }
  idle() {
    if (this.child || this.testing || this.active)
      throw Error("Harness 正在运行，请先等待或停止当前任务");
  }
  configure(i) {
    this.idle();
    const old = this.data.config,
      provider = i.provider;
    if (!["openai", "deepseek-official"].includes(provider))
      throw Error("请选择受支持的 Harness 模型路由");
    const model = text(i.model, 160);
    if (!model) throw Error("请填写模型ID");
    const timeout = Number(i.timeout);
    if (!Number.isInteger(timeout) || timeout < 10 || timeout > 3600)
      throw Error("任务超时请设为10–3600秒");
    this.data.config = {
      ...old,
      provider,
      model,
      timeout,
      reasoningEffort: text(i.reasoningEffort || "", 40),
      usePersona: i.usePersona === true,
    };
    this.save();
    return this.view();
  }
  async pick(kind) {
    this.idle();
    const r = await this.h.e.dialog.showOpenDialog({
      title: kind === "app" ? "选择 DeepSeek Harness.app" : "选择任务工作目录",
      properties: kind === "app" ? ["openFile"] : ["openDirectory"],
      ...(kind === "app"
        ? { filters: [{ name: "DeepSeek Harness", extensions: ["app"] }] }
        : {}),
    });
    if (r.canceled) return this.view();
    const dir = fs.realpathSync(r.filePaths[0]);
    if (kind === "app") {
      this.resolveInstallation(dir);
      this.data.config.appPath = dir;
    } else this.data.config.workspace = dir;
    this.save();
    return this.view();
  }
  async boot() {
    const c = this.data.config,
      app = this.resolveInstallation(c.appPath);
    fs.mkdirSync(c.workspace, { recursive: true });
    // overlay 只声明适配器和凭据引用，模型密钥由 Harness 自己解析。
    const patch = path.join(this.h.root, "harness-sdk.patch.yml");
    fs.writeFileSync(
      patch,
      JSON.stringify([
        {
          id: "llm-pi-ai",
          config: { providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } } },
        },
        {
          id: "sandbox-policy",
          config: { mode: "workspace-write", workspaceRoot: c.workspace },
        },
        { id: "approval", config: { policy: "ask" } },
      ]),
      { mode: 0o600 },
    );
    this.connection = "starting";
    this.buffer = "";
    this.stderrBytes = 0;
    const generation = ++this.sequence;
    const child = this.spawn(app.exe, [...app.args, "--patch", patch], {
      cwd: c.workspace,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        DSH_PERMISSION_MODE: "workspace-write",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdin.on("error", () => {});
    child.stdout.on("data", (bytes) => {
      if (this.child !== child) return;
      this.buffer += bytes.toString("utf8");
      if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) {
        this.breakConnection(Error("Harness 协议响应过大"), child);
        return;
      }
      let at;
      while ((at = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + 1);
        if (!line.trim()) continue;
        try {
          this.frame(JSON.parse(line));
        } catch {
          this.breakConnection(Error("Harness SDK返回无效协议帧"), child);
          return;
        }
      }
    });
    child.stderr.on("data", (b) => {
      this.stderrBytes += b.length;
    }); // 不把可能包含凭据的原始启动诊断转存或回显。
    child.on("error", (err) =>
      this.breakConnection(
        Error("Harness进程无法启动：" + (err.code || "启动失败")),
        child,
      ),
    );
    child.on("close", () => {
      if (this.child !== child) return;
      this.child = null;
      this.connection = "idle";
      this.rejectPending(Error("Harness连接已结束"));
      this.questions.clear();
    });
    const result = await this.request(
      "initialize",
      {
        cwd: c.workspace,
        provider: c.provider,
        model: c.model,
        approvalRequests: true,
        capabilities: { userQuestions: true },
        ...(c.reasoningEffort ? { reasoningEffort: c.reasoningEffort } : {}),
      },
      45000,
    );
    if (generation !== this.sequence || this.child !== child)
      throw Error("Harness连接已取消");
    if (result?.serverInfo?.name !== "deepseek-harness-sdk-runtime")
      throw Error("运行时不是预期的官方Harness SDK");
    this.connection = "connected";
    return result;
  }
  send(frame) {
    if (!this.child || this.child.stdin.destroyed) throw Error("Harness未连接");
    this.child.stdin.write(JSON.stringify(frame) + "\n");
  }
  request(method, params, timeout = 45000) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId,
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(Error("Harness请求超时；不会自动重试"));
        }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  rejectPending(err) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
  breakConnection(err, child = this.child) {
    if (child !== this.child) return;
    this.rejectPending(err);
    this.questions.clear();
    child?.kill("SIGTERM");
  }
  frame(frame) {
    if (frame.jsonrpc !== "2.0") throw Error("protocol");
    if (frame.method && frame.id !== undefined) {
      if (!["approval/request", "user-question/ask"].includes(frame.method)) {
        this.send({
          jsonrpc: "2.0",
          id: frame.id,
          error: { code: -32601, message: "Unsupported host request" },
        });
        return;
      }
      if (
        !this.active ||
        !ACTIVE.has(this.active.status) ||
        !this.ownedSessions?.has(frame.params?.sessionId)
      ) {
        this.send({
          jsonrpc: "2.0",
          id: frame.id,
          error: { code: -32603, message: "Session not owned by Whale Isle" },
        });
        return;
      }
      const q = {
        id: crypto.randomUUID(),
        wireId: frame.id,
        kind: frame.method,
        params: frame.params,
      };
      this.questions.set(q.id, q);
      this.active.status = "waiting";
      this.save();
      return;
    }
    if (frame.id !== undefined) {
      const p = this.pending.get(frame.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(frame.id);
      frame.error
        ? p.reject(
            Error(
              redactSecrets(
                String(frame.error.message || "Harness请求失败"),
              ).slice(0, 1000),
            ),
          )
        : p.resolve(frame.result);
      return;
    }
    const p = frame.params;
    if (!p || !this.active || !ACTIVE.has(this.active.status)) return;
    if (
      frame.method === "subagent.started" &&
      this.ownedSessions.has(p.parentSessionId)
    ) {
      this.ownedSessions.add(p.childSessionId);
      return;
    }
    if (!this.ownedSessions.has(p.sessionId)) return;
    if (frame.method === "user-question.cancelled") {
      for (const [id, q] of this.questions)
        if (q.params.requestId === p.requestId) this.questions.delete(id);
      return;
    }
    if (p.sessionId !== this.active.id) return;
    if (
      frame.method === "session.status" &&
      p.status === "running" &&
      this.questions.size === 0
    )
      this.active.status = "running";
    if (frame.method === "session.event") {
      const e = p.event;
      if (e?.type === "assistant/message")
        this.active.result = (e.data?.message?.content || [])
          .filter((x) => x.type === "text")
          .map((x) => x.text)
          .join("")
          .slice(0, 100000);
      if (e?.type === "turn/end")
        this.active.finishReason = e.data?.reason?.kind;
      if (e?.type === "tool/call") this.active.lastActivity = "工具执行";
    }
  }
  answer(i) {
    const q = this.questions.get(i.id);
    if (!q || !this.child) throw Error("该请求已取消或已经回答");
    let result;
    if (q.kind === "approval/request") {
      if (!["allowed-once", "rejected", "cancelled"].includes(i.outcome))
        throw Error("审批结果无效");
      result = { outcome: i.outcome };
    } else {
      if (i.cancelled) result = { cancelled: true };
      else {
        const asked = q.params.questions;
        if (!Array.isArray(i.answers) || i.answers.length !== asked.length)
          throw Error("请填写每个问题的答案");
        const seen = new Set();
        for (const a of i.answers) {
          const question = asked.find((x) => x.id === a.id);
          if (
            !question ||
            seen.has(a.id) ||
            !Array.isArray(a.selected) ||
            a.selected.some(
              (x) => !question.options?.some((o) => o.label === x),
            ) ||
            (!question.multiSelect && a.selected.length > 1) ||
            (!a.selected.length && !String(a.custom || "").trim()) ||
            typeof (a.custom || "") !== "string"
          )
            throw Error("答案不完整或选项无效");
          seen.add(a.id);
        }
        result = { answers: i.answers };
      }
    }
    this.send({ jsonrpc: "2.0", id: q.wireId, result });
    this.questions.delete(i.id);
    if (this.active && this.questions.size === 0)
      this.active.status = "running";
    this.save();
    return this.view();
  }
  async shutdown() {
    if (this.closing) return this.closing;
    this.closing = this.shutdownProcess();
    try {
      await this.closing;
    } finally {
      this.closing = null;
    }
  }
  async shutdownProcess() {
    const child = this.child;
    if (!child) return;
    this.questions.clear();
    const done = new Promise((r) => child.once("close", r));
    try {
      await this.request("shutdown", undefined, 4000);
    } catch {
      child.kill("SIGTERM");
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
    await done;
    clearTimeout(timer);
  }
  async test() {
    this.idle();
    this.testing = true;
    try {
      const result = await this.boot();
      this.lastTest = {
        ok: true,
        message: "官方SDK握手成功（尚未调用模型）",
        at: Date.now(),
        runtime: result.serverInfo,
      };
      return this.view();
    } catch (e) {
      this.lastTest = { ok: false, message: e.message, at: Date.now() };
      return this.view();
    } finally {
      await this.shutdown();
      this.testing = false;
    }
  }
  run(i) {
    this.idle();
    const prompt = text(i.text, 20000);
    if (!prompt) throw Error("请填写任务");
    const task = {
      id: "whale-isle-" + crypto.randomUUID(),
      text: prompt,
      status: "starting",
      createdAt: Date.now(),
      result: "",
      error: "",
      workspace: this.data.config.workspace,
      provider: this.data.config.provider,
      model: this.data.config.model,
    };
    const persona = this.data.config.usePersona
      ? composePrompt(this.h.state.data.prompts, "private")
      : "";
    this.data.tasks.unshift(task);
    this.data.tasks = this.data.tasks.slice(0, 100);
    this.active = task;
    this.ownedSessions = new Set([task.id]);
    this.save();
    this.running = this.execute(task, persona);
    return this.view();
  }
  async execute(task, persona) {
    let deadline;
    try {
      deadline = setTimeout(() => {
        task.status = "timed_out";
        task.error = "任务超时，已请求停止；已执行的文件操作不会回滚。";
        void this.shutdown();
      }, this.data.config.timeout * 1000);
      await this.boot();
      if (!ACTIVE.has(task.status)) return;
      task.status = "running";
      this.save();
      const content = persona
        ? "以下是用户选择的角色表达偏好，执行权限仍以Harness原生机制为准：\n" +
          persona +
          "\n\n用户任务：\n" +
          task.text
        : task.text;
      await this.request("session/prompt", {
        sessionId: task.id,
        contentBlocks: [{ type: "text", text: content }],
      });
      await this.request(
        "session/wait",
        { sessionId: task.id },
        this.data.config.timeout * 1000,
      );
      if (ACTIVE.has(task.status)) {
        task.status =
          task.finishReason && task.finishReason !== "completed"
            ? "failed"
            : "completed";
        if (task.status === "failed")
          task.error = "Harness结束原因：" + task.finishReason;
      }
    } catch (e) {
      if (ACTIVE.has(task.status)) {
        task.status = "failed";
        task.error = redactSecrets(String(e.message)).slice(0, 1000);
      }
    } finally {
      clearTimeout(deadline);
      await this.shutdown();
      task.finishedAt = Date.now();
      this.questions.clear();
      this.active = null;
      this.save();
    }
  }
  async stop() {
    if (this.active) {
      this.active.status = "stopped";
      this.active.error = "用户已停止任务；已执行操作不会自动回滚。";
      this.save();
    }
    await this.shutdown();
    return this.view();
  }
  async invoke(action, i = {}) {
    switch (action) {
      case "dsh-state":
        return this.view();
      case "dsh-save":
        return this.configure(i);
      case "dsh-pick-workspace":
        return this.pick("workspace");
      case "dsh-pick-app":
        return this.pick("app");
      case "dsh-test":
        return this.test();
      case "dsh-run":
        return this.run(i);
      case "dsh-stop":
        return this.stop();
      case "dsh-answer":
        return this.answer(i);
      case "dsh-open-workspace":
        fs.mkdirSync(this.data.config.workspace, { recursive: true });
        {
          const error = await this.h.e.shell.openPath(
            this.data.config.workspace,
          );
          if (error) throw Error("无法打开工作目录：" + error);
        }
        return { ok: true };
      default:
        throw Error("未知Harness操作");
    }
  }
  async close() {
    await this.stop();
    await this.running;
  }
}
module.exports = { Harness, installation };
