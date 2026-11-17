"use strict";
const { spawn } = require("node:child_process");
// 原版 API 1 返回整数，API 2 返回 UTF-8 文本；不能按 API 3 的 JSON 输出协议解析。
function runLegacy(wasm, api, input) {
  return new Promise((resolve, reject) => {
    const code = `let body='';process.stdin.setEncoding('utf8').on('data',c=>body+=c).on('end',()=>{try{const p=JSON.parse(body),bytes=Buffer.from(p.input),out=[],imports={input_size:()=>bytes.length,input_byte:i=>bytes[i]??-1};if(p.api===2)imports.output_byte=v=>{if(!Number.isInteger(v)||v<0||v>255||out.length>=65536)throw Error();out.push(v)};const m=new WebAssembly.Module(Buffer.from(p.wasm,'base64'));if(WebAssembly.Module.imports(m).some(i=>i.module!=='whale'||i.kind!=='function'||!Object.hasOwn(imports,i.name)))throw Error();const value=new WebAssembly.Instance(m,{whale:imports}).exports.run();if(!Number.isInteger(value))throw Error();if(p.api===1)process.stdout.write(String(value));else if(value===0)process.stdout.write(new TextDecoder('utf8',{fatal:true}).decode(Uint8Array.from(out)));else throw Error()}catch{process.exitCode=1}})`;
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=64",
        "--wasm-max-mem-pages=16",
        "--wasm-max-table-size=1024",
        "--no-addons",
        "-e",
        code,
      ],
      {
        env: {
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        },
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    let output = "",
      settled = false;
    const end = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      err ? reject(err) : resolve(output);
    };
    const timer = setTimeout(() => end(Error("插件运行超时")), 5000);
    child.on("error", end);
    child.stdout.on("data", (c) => {
      output += c.toString("utf8");
      if (output.length > 100000) end(Error("插件输出过大"));
    });
    child.on("close", (c) => end(c === 0 ? null : Error("插件执行失败")));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ wasm, api, input: String(input) }));
  });
}
module.exports = { runLegacy };
