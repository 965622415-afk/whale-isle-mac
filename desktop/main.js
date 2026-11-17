"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  dialog,
  shell,
  session,
  net,
  safeStorage,
  Notification,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { Host } = require("./host");
app.setName("Whale Isle");
const testArg = process.argv.find((x) => x.startsWith("--test-data="));
app.setPath(
  "userData",
  testArg
    ? path.resolve(testArg.slice(12))
    : path.join(app.getPath("appData"), "Whale Isle"),
);
let win,
  host,
  quitting = false,
  operation = false;
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
const rendererUrl = pathToFileURL(
  path.join(__dirname, "renderer", "index.html"),
).href;
function window() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: "鲸屿 · AI 配置中心",
    backgroundColor: "#f5f7fb",
    titleBarStyle: "hiddenInset",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== rendererUrl) e.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "鲸屿",
        submenu: [
          {
            label: "关于鲸屿",
            click: () =>
              dialog.showMessageBox({
                message: "鲸屿 · AI 配置中心",
                detail:
                  "macOS " +
                  require("./package.json").version +
                  "\n基于 Banan1cee/whale_girl 的独立派生版本\nAGPL-3.0-only\n此版本不接入微信。",
              }),
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "窗口",
        submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
      },
      {
        label: "帮助",
        submenu: [
          {
            label: "项目源码",
            click: () =>
              shell.openExternal(
                "https://github.com/965622415-afk/whale-isle-mac",
              ),
          },
          {
            label: "上游项目与致谢",
            click: () =>
              shell.openExternal("https://github.com/Banan1cee/whale_girl"),
          },
        ],
      },
    ]),
  );
  try {
    host = new Host({
      root: app.getPath("userData"),
      source: path.resolve(__dirname, ".."),
      electron: { dialog, shell, session, net, safeStorage, Notification },
      emit: (data) => {
        if (win && !win.isDestroyed()) win.webContents.send("isle:chat", data);
      },
    });
    await host.ready();
    ipcMain.handle("isle:invoke", async (event, action, input) => {
      if (
        event.sender !== win?.webContents ||
        event.senderFrame?.url !== rendererUrl
      )
        throw new Error("请求来源无效");
      const readOnly = [
        "state",
        "logs",
        "about",
        "memory-list",
        "chat-history",
        "chat-stop",
      ].includes(action);
      if (operation && !readOnly)
        return { ok: false, error: "当前操作尚未结束，请稍候或先停止生成" };
      if (!readOnly) operation = true;
      try {
        const value = await host.invoke(action, input);
        if (action === "memory-restore" && value.restart) {
          app.relaunch();
          setImmediate(() => app.quit());
        }
        return { ok: true, value };
      } catch (err) {
        return {
          ok: false,
          error: require("../src/infra/errors").errorMessage(err),
        };
      } finally {
        if (!readOnly) operation = false;
      }
    });
    window();
    const smoke = process.argv.find((x) => x.startsWith("--smoke-output="));
    if (smoke) {
      const { run } = require("./test/smoke");
      try {
        const result = await run(host, win);
        fs.writeFileSync(smoke.slice(15), JSON.stringify(result, null, 2));
      } catch (err) {
        fs.writeFileSync(
          smoke.slice(15),
          JSON.stringify({ ok: false, error: err.stack }),
        );
      }
      app.quit();
    }
  } catch (err) {
    dialog.showErrorBox("鲸屿启动失败", String(err.message || err));
    app.quit();
  }
});
app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length && host) window();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (host && !quitting) {
    event.preventDefault();
    quitting = true;
    host.close().finally(() => app.quit());
  }
});
