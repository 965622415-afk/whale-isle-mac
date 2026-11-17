"use strict";
pages.splice(
  pages.findIndex((p) => p[0] === "bridge"),
  0,
  ["harness", "✦", "Harness 任务"],
);
pages.find((p) => p[0] === "bridge")[2] = "微信桥接";
const dshLabels = {
  starting: "正在启动",
  running: "执行中",
  waiting: "等待你的回答",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  timed_out: "已超时",
  interrupted: "上次连接已中断",
};
let dshState;
function dshPending() {
  return dshState.pending
    .map((q) =>
      q.kind === "approval/request"
        ? `<section class="panel"><h2>Harness 请求单次授权</h2><p>工具：${esc(q.params.toolName)}</p><pre>${esc(q.params.reason || "Harness 请求执行需要批准的操作。")}</pre><div class="actions"><button data-action="dsh-approve" data-id="${esc(q.id)}">仅允许这一次</button><button data-action="dsh-reject" data-id="${esc(q.id)}">拒绝</button></div></section>`
        : `<form class="panel dsh-question-form" data-question-id="${esc(q.id)}"><h2>Harness 需要你的回答</h2>${(q.params.questions || []).map((item, n) => `<fieldset><legend>${esc(item.header || item.question)}</legend><p>${esc(item.question)}</p>${item.detail ? `<pre>${esc(item.detail)}</pre>` : ""}${(item.options || []).map((o, j) => `<label class="check"><input type="${item.multiSelect ? "checkbox" : "radio"}" name="q-${n}" value="${j}">${esc(o.label)}${o.description ? " · " + esc(o.description) : ""}</label>`).join("")}<textarea name="custom-${n}" rows="2" placeholder="输入补充回答"></textarea></fieldset>`).join("")}<div class="actions"><button class="primary">提交回答</button><button type="button" data-action="dsh-question-cancel" data-id="${esc(q.id)}">取消</button></div></form>`,
    )
    .join("");
}
function dshResults() {
  return (
    dshState.tasks
      .map(
        (t) =>
          `<section class="panel"><div class="row"><strong>${esc(dshLabels[t.status] || t.status)}</strong><small>${esc(new Date(t.createdAt).toLocaleString())}</small></div><p>${esc(t.text)}</p><small>${esc(t.provider)} / ${esc(t.model)}</small>${t.result ? `<pre>${esc(t.result)}</pre>` : ""}${t.error ? `<div class="hint warning">${esc(t.error)}</div>` : ""}<details><summary>任务信息</summary><p>会话：${esc(t.id)}<br>工作目录：${esc(t.workspace)}</p></details></section>`,
      )
      .join("") ||
    '<div class="panel empty">从一条任务开始，例如：在工作目录创建一份计划文件。</div>'
  );
}
async function refreshDsh() {
  if (page !== "harness") return;
  dshState = await api("dsh-state");
  if (page !== "harness") return;
  $("#dsh-status").textContent =
    dshState.connection === "connected"
      ? "已连接官方 SDK"
      : dshState.connection === "starting"
        ? "正在启动 SDK"
        : "SDK 待命";
  const container = $("#dsh-pending");
  if (container) {
    const signature = JSON.stringify(dshState.pending);
    if (container.dataset.signature !== signature) {
      container.innerHTML = dshPending();
      container.dataset.signature = signature;
    }
  }
  if ($("#dsh-results")) $("#dsh-results").innerHTML = dshResults();
}
workPages.harness = async () => {
  dshState = await api("dsh-state");
  const c = dshState.config;
  $("#active-model").textContent = "Harness / " + c.provider + " / " + c.model;
  $("#content").innerHTML =
    `<div class="panel"><h2>DeepSeek Harness 任务中心</h2><p>使用你已安装的 Harness 官方 SDK profile 执行任务，模型凭据由 Harness 自己读取。这里的会话与桌面聊天页独立；不会改动原有聊天或复制 API Key。</p><div class="hint"><span id="dsh-status">${esc(dshState.connection)}</span> · ${dshState.installed ? "已发现本机 Harness" : "请先选择 Harness.app"}</div><div class="actions"><button data-action="dsh-test">测试 SDK 连接</button><button data-action="dsh-stop" class="danger">停止当前任务</button><button data-action="dsh-open-workspace">打开工作目录</button></div>${dshState.lastTest ? `<div class="hint ${dshState.lastTest.ok ? "success" : "warning"}">${esc(dshState.lastTest.message)}</div>` : ""}</div><details class="panel"><summary>连接与任务设置</summary><p>应用：${esc(c.appPath)}<br>目录：${esc(c.workspace)}</p><div class="actions"><button data-action="dsh-pick-app">选择 Harness.app</button><button data-action="dsh-pick-workspace">选择工作目录</button></div><form id="dsh-config"><div class="fields">${select(
      "Harness 模型提供方",
      "provider",
      c.provider,
      [
        ["openai", "OpenAI（Harness 已配置的凭据）"],
        ["deepseek-official", "DeepSeek 官方（Harness 已配置的凭据）"],
      ],
    )}${field("模型 ID", "model", c.model)}${field("推理强度（留空沿用模型默认）", "reasoningEffort", c.reasoningEffort)}${field("任务超时 / 秒", "timeout", c.timeout, "number", false, 'min="10" max="3600"')}<label class="check"><input type="checkbox" name="usePersona" ${c.usePersona ? "checked" : ""}>将当前人设提示词作为表达偏好附给任务</label></div><button class="primary">保存 Harness 设置</button></form><p>默认采用 Harness 的工作目录写入与询问审批机制。请求额外权限时，由你在此页逐次回答。停止或超时不会回滚已经执行的操作；不会自动重发任务。</p></details><div id="dsh-pending">${dshPending()}</div><form id="dsh-task" class="panel"><h2>交给 Harness 的任务</h2><textarea name="text" rows="4" maxlength="20000" placeholder="例如：阅读这个工作目录，整理一份文件清单保存为清单.md" required></textarea><div class="actions"><button class="primary">提交任务</button><small>会调用 Harness 中所选的模型，产生正常模型用量。</small></div></form><div id="dsh-results">${dshResults()}</div>`;
};
Object.assign(
  actions,
  Object.fromEntries(
    ["test", "stop", "pick-app", "pick-workspace", "open-workspace"].map(
      (name) => [
        "dsh-" + name,
        async () => {
          const r = await api("dsh-" + name);
          if (name === "test")
            toast(r.lastTest?.message || "连接测试结束", !r.lastTest?.ok);
          if (page === "harness" && !dirty) await workPages.harness();
        },
      ],
    ),
  ),
);
Object.assign(actions, {
  "dsh-approve": async (id) => {
    await api("dsh-answer", { id, outcome: "allowed-once" });
    await refreshDsh();
  },
  "dsh-reject": async (id) => {
    await api("dsh-answer", { id, outcome: "rejected" });
    await refreshDsh();
  },
  "dsh-question-cancel": async (id) => {
    await api("dsh-answer", { id, cancelled: true });
    await refreshDsh();
  },
});
document.addEventListener("input", (e) => {
  if (e.target.closest("#dsh-config,#dsh-task")) dirty = true;
});
document.addEventListener("submit", (e) => {
  if (!e.target.matches("#dsh-config,#dsh-task,.dsh-question-form")) return;
  e.preventDefault();
  run(async () => {
    if (e.target.id === "dsh-config") {
      await api("dsh-save", formValues(e.target));
      dirty = false;
      await workPages.harness();
      toast("Harness设置已保存");
    } else if (e.target.id === "dsh-task") {
      await api("dsh-run", formValues(e.target));
      e.target.reset();
      dirty = false;
      await refreshDsh();
      toast("任务已提交给 Harness");
    } else {
      const q = dshState.pending.find(
        (x) => x.id === e.target.dataset.questionId,
      );
      if (!q) throw Error("问题已取消");
      const answers = q.params.questions.map((item, n) => ({
        id: item.id,
        selected: [...e.target.querySelectorAll(`[name="q-${n}"]:checked`)].map(
          (el) => item.options[Number(el.value)].label,
        ),
        custom: e.target.querySelector(`[name="custom-${n}"]`).value,
      }));
      await api("dsh-answer", { id: q.id, answers });
      await refreshDsh();
    }
  });
});
setInterval(() => {
  if (page === "harness") run(refreshDsh);
}, 1500);
