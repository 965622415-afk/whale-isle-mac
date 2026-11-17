"use strict";
const readline = require("node:readline");
const send = (x) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...x }) + "\n");
let session = "",
  prompt = "",
  waitingId;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const f = JSON.parse(line);
  if (f.method === "initialize")
    send({
      id: f.id,
      result: {
        serverInfo: {
          name: "deepseek-harness-sdk-runtime",
          version: "fixture",
        },
      },
    });
  else if (f.method === "session/prompt") {
    session = f.params.sessionId;
    prompt = f.params.contentBlocks[0].text;
    send({ id: f.id, result: { messageId: "fixture" } });
    send({
      method: "session.status",
      params: { sessionId: session, status: "running" },
    });
    if (prompt.includes("CHILD_APPROVAL"))
      send({
        method: "subagent.started",
        params: {
          parentSessionId: session,
          childSessionId: session + "-child",
        },
      });
    if (prompt.includes("APPROVAL"))
      send({
        id: "server-approval",
        method: "approval/request",
        params: {
          sessionId: prompt.includes("CHILD_APPROVAL")
            ? session + "-child"
            : session,
          toolName: "fixture-write",
          reason: "Test-only approval",
        },
      });
  } else if (f.method === "session/wait") {
    waitingId = f.id;
    if (!prompt.includes("APPROVAL") && !prompt.includes("BLOCK")) complete();
  } else if (f.id === "server-approval") {
    if (f.result?.outcome === "allowed-once") complete();
    else {
      send({ id: waitingId, error: { code: -32603, message: "Rejected" } });
    }
  } else if (f.method === "shutdown") {
    if (session)
      send({
        method: "session.status",
        params: { sessionId: session, status: "running" },
      });
    send({ id: f.id, result: {} });
    setImmediate(() => process.exit(0));
  }
});
function complete() {
  send({
    method: "session.event",
    params: {
      sessionId: session,
      event: {
        type: "assistant/message",
        data: { message: { content: [{ type: "text", text: "测试完成" }] } },
      },
    },
  });
  send({
    method: "session.event",
    params: {
      sessionId: session,
      event: { type: "turn/end", data: { reason: { kind: "completed" } } },
    },
  });
  send({ id: waitingId, result: {} });
}
