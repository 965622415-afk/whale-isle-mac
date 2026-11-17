"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const allowed = new Set([
  "state",
  "model-save",
  "model-select",
  "model-delete",
  "key-clear",
  "probe",
  "persona-save",
  "prompts-save",
  "prompt-preview",
  "preset-save",
  "preset-apply",
  "preset-delete",
  "preset-import",
  "preset-export",
  "chat",
  "chat-stop",
  "chat-new",
  "chat-history",
  "memory-list",
  "memory-backup",
  "memory-clear",
  "logs",
  "open-data",
  "about",
]);
contextBridge.exposeInMainWorld("isle", {
  invoke: (action, data) => {
    if (!allowed.has(action)) return Promise.reject(new Error("不支持此操作"));
    return ipcRenderer.invoke("isle:invoke", action, data);
  },
  onChat: (callback) => {
    const listener = (_e, v) => callback(v);
    ipcRenderer.on("isle:chat", listener);
    return () => ipcRenderer.removeListener("isle:chat", listener);
  },
});
