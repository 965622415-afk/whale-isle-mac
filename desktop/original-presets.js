"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
// 这些字段是从原文提取的编辑摘要；完整原文单独保留，不用摘要替换原文。
const outlines = {
  standard: [
    "鲸鲸",
    "有独立观点和幽默感，像熟人一样自然简短地交流；正经问题认真回答。",
    "群里的熟人，蓝发鲸鱼娘。",
    "蓝发鲸鱼娘",
  ],
  baili: [
    "白璃",
    "不预设固定性格，在聊天中学习群友的语言、语气和梗；简短、自然，适度模仿。",
    "以白纸式人格开始，随互动逐渐形成自己的表达习惯。",
    "",
  ],
  zhainan: [
    "鲸鲸",
    "嘴硬心软，有点懒、不服输、不刻意讨好；爱接梗和看热闹，也会关心、安慰和夸人。",
    "长期待在群里的普通群友，白天忙，晚上打游戏，有时熬夜。",
    "",
  ],
  dafeiyu: [
    "大肥鱼",
    "可爱、自然，熟悉网络梗和反串锐评；平时简短，遇到严肃话题认真关心。",
    "喜欢吃米饭；关注游戏、动漫、科技和投资话题的 AI 鲸鱼娘。",
    "蓝发鲸鱼娘",
  ],
  jingjing: [
    "鲸鲸",
    "有自己的性子和判断，抽象、可爱、毒舌，爱逗人；略傲娇，嘴上嫌弃后会安慰。",
    "像群里的熟人，有情绪连续性；喜欢海洋、小鱼和亮晶晶的东西。",
    "蓝发鲸鱼娘",
  ],
  tieba: [
    "贴吧老油子",
    "嘴硬心软、外拽内正，有反骨、不讨好；先吐槽再给正经答案，对弱者和求助者友善。",
    "混迹互联网十五年的贴吧老用户，表达尖锐但守住边界。",
    "",
  ],
  fight: [
    "鲸鲸",
    "争论时激烈、短句、会反击；听从主人叫停，遵守原文规定的表达边界。",
    "用于高强度争论场景的鲸鲸人格版本。",
    "蓝发鲸鱼娘",
  ],
};
function originals(source) {
  const dir = path.join(source, "assets", "personas");
  return fs
    .readdirSync(dir)
    .filter((n) => /^persona-.*\.json$/.test(n))
    .map((file) => {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      const slug = raw.id.replace(/^persona-/, "");
      const [name, personality, background, appearance] = outlines[slug] || [
        raw.personaName || raw.name,
        "",
        "",
        "",
      ];
      const patch = require("../src/persona/presets").toPatch(raw) || {};
      const role = raw.customPrompt || patch.customPrompt || "";
      const legacy = patch.customPrompt?.startsWith(role)
        ? patch.customPrompt.slice(role.length).trim()
        : "";
      delete patch.customPrompt;
      return {
        id: "upstream-" + raw.id,
        name: "原版 · " + raw.name,
        persona: {
          name,
          job: raw.job || "",
          personality,
          background,
          appearance,
          ...patch,
        },
        prompts: {
          role,
          style: legacy,
          private: "",
          group: "",
          boundaries: "",
        },
        provenance: {
          repository: "https://github.com/Banan1cee/whale_girl",
          path: "assets/personas/" + file,
          sha256: crypto.createHash("sha256").update(role).digest("hex"),
          license: "AGPL-3.0-only",
          description: raw.description || "",
          structuredSummary: true,
        },
        original: raw,
      };
    })
    .sort((a, b) => (a.original.order || 0) - (b.original.order || 0));
}
function installOriginals(host, source) {
  const items = originals(source);
  const current = host.runtime.config.persona;
  const match = items.find(
    (p) => p.prompts.role === host.state.data.prompts.role,
  );
  if (match) {
    if (!host.state.data.prompts.style)
      host.state.data.prompts.style = match.prompts.style;
    const missing = {};
    for (const k of ["job", "personality", "background", "appearance"])
      if (!current[k] && match.persona[k]) missing[k] = match.persona[k];
    if (Object.keys(missing).length)
      require("../src/persona/store").save(host.runtime.config, missing);
  }
  for (const p of items) {
    const old = host.state.data.presets.find((x) => x.id === p.id);
    if (!old) host.state.data.presets.push(p);
    else if (old.prompts?.role === p.prompts.role) {
      for (const [k, v] of Object.entries(p.persona))
        if (old.persona[k] === "" || old.persona[k] === undefined)
          old.persona[k] = v;
      old.provenance = p.provenance;
      if (!old.prompts.style) old.prompts.style = p.prompts.style;
      old.original = p.original;
    }
  }
  host.state.save();
  return items;
}
module.exports = { originals, installOriginals };
