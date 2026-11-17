"use strict";
const READ_ONLY = new Set([
  "state",
  "logs",
  "about",
  "memory-list",
  "memory-detail",
  "chat-history",
  "chat-stop",
  "workbench-settings",
  "original-list",
  "tts-state",
  "sticker-list",
  "reminder-list",
  "diary-list",
  "budget",
  "moment-list",
  "plugin-list",
  "dsh-state",
  "dsh-stop",
  "dsh-answer",
]);
class OperationGate {
  constructor() {
    this.busy = false;
  }
  async run(action, fn) {
    const read = READ_ONLY.has(action);
    if (this.busy && !read) throw Error("当前操作尚未结束，请稍候或先停止生成");
    if (!read) this.busy = true;
    try {
      return await fn();
    } finally {
      if (!read) this.busy = false;
    }
  }
}
module.exports = { OperationGate };
