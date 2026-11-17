"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
async function main() {
  const root = path.resolve(__dirname, "../.."),
    artifacts = path.join(root, "artifacts"),
    stage = path.join(artifacts, "mac-stage");
  fs.mkdirSync(stage, { recursive: true });
  // 构建目录与运行数据分离，仅打包明确列出的程序文件。
  for (const name of ["src", "assets", "config", "LICENSE"])
    fs.cpSync(path.join(root, name), path.join(stage, name), {
      recursive: true,
    });
  const core = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify({
      name: "whale-isle",
      version: core.version,
      main: "desktop/main.js",
      description: "鲸屿 · AI 配置中心",
      author: "Whale Isle contributors",
      license: "AGPL-3.0-only",
    }),
  );
  const dest = path.join(stage, "desktop");
  fs.mkdirSync(dest, { recursive: true });
  for (const name of [
    "main.js",
    "host.js",
    "state.js",
    "transport.js",
    "preload.js",
    "package.json",
    "renderer",
  ])
    fs.cpSync(path.join(root, "desktop", name), path.join(dest, name), {
      recursive: true,
    });
  const iconDir = path.join(artifacts, "WhaleIsle.iconset");
  fs.mkdirSync(iconDir, { recursive: true });
  const original = path.join(artifacts, "icon-1024.png");
  execFileSync("swift", [
    "-module-cache-path",
    path.join(artifacts, "swift-cache"),
    path.join(__dirname, "make-icon.swift"),
    original,
  ]);
  for (const n of [16, 32, 128, 256, 512])
    for (const scale of [1, 2])
      execFileSync(
        "sips",
        [
          "-z",
          String(n * scale),
          String(n * scale),
          original,
          "--out",
          path.join(iconDir, `icon_${n}x${n}${scale === 2 ? "@2x" : ""}.png`),
        ],
        { stdio: "ignore" },
      );
  const icon = path.join(artifacts, "WhaleIsle.icns");
  execFileSync("iconutil", ["-c", "icns", iconDir, "-o", icon]);
  const zipDir = path.join(artifacts, "electron");
  const zip = path.join(zipDir, "electron-v45.3.3-darwin-arm64.zip");
  if (fs.existsSync(zip)) {
    const expected = require("../node_modules/electron/checksums.json")[
      "electron-v45.3.3-darwin-arm64.zip"
    ];
    const got = require("node:crypto")
      .createHash("sha256")
      .update(fs.readFileSync(zip))
      .digest("hex");
    if (got !== expected) throw new Error("Electron ZIP checksum mismatch");
  }
  const { packager } = await import("@electron/packager");
  const version = require("../package.json").version;
  const output = await packager({
    dir: stage,
    name: "Whale Isle",
    platform: "darwin",
    arch: "arm64",
    electronVersion: "45.3.3",
    ...(fs.existsSync(zip) ? { electronZipDir: zipDir } : {}),
    out: path.join(artifacts, "mac"),
    overwrite: true,
    asar: true,
    prune: false,
    appBundleId: "io.whaleisle.config",
    appVersion: version,
    buildVersion: version,
    icon,
    appCopyright:
      "Whale Isle contributors; upstream Whale Girl contributors (AGPL-3.0-only)",
    extendInfo: {
      CFBundleDisplayName: "鲸屿 · AI 配置中心",
      LSMinimumSystemVersion: "13.0",
      NSHumanReadableCopyright: "AGPL-3.0-only · 基于 Banan1cee/whale_girl",
    },
  });
  for (const folder of output) {
    const app = path.join(folder, "Whale Isle.app");
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
      stdio: "inherit",
    });
  }
  console.log(JSON.stringify({ output, version }));
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
