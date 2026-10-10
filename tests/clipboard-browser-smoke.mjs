// Manual browser check: node tests/clipboard-browser-smoke.mjs
// Open http://0.0.0.0:3199 (HTTP, unlike localhost it is not a secure context).
// Only synthetic text is served; no database, credentials, DNS or CA access.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import ts from "typescript";

const script = ts.transpileModule(readFileSync(new URL("../lib/clipboard.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
}).outputText;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CertOps 复制回归测试</title>
<style>body{max-width:800px;margin:60px auto;font:18px system-ui}button{padding:12px;margin:8px}textarea{display:block;width:95%;height:180px;margin:16px 0}#result{color:#245}</style>
<h1>CertOps HTTP 复制回归测试</h1><p id="environment"></p>
<p>本页仅使用合成测试文本，不含真实证书或私钥。</p>
<button id="old">复现旧复制逻辑</button><button id="fixed">验证修复后复制</button>
<p id="result" role="status">等待测试</p><label for="paste">粘贴到这里验证完整内容</label><textarea id="paste"></textarea>
<script type="module">
${script}
const pem = ${JSON.stringify("-----BEGIN CERTIFICATE-----\nTEST+LINE/ONE==\nTESTLINE2\n-----END CERTIFICATE-----\n")};
const result = document.getElementById("result");
document.getElementById("environment").textContent = "安全上下文：" + window.isSecureContext + "；Clipboard API：" + typeof navigator.clipboard;
document.getElementById("old").onclick = async () => {
  try { await navigator.clipboard.writeText(pem); result.textContent = "旧逻辑复制成功"; }
  catch { result.textContent = "已复现：旧逻辑复制失败"; }
};
document.getElementById("fixed").onclick = async () => {
  try {
    await new Promise(resolve => setTimeout(resolve, 300));
    await copyText(pem);
    result.textContent = "修复后复制成功，请粘贴验证";
  } catch { result.textContent = "修复后复制失败"; }
};
document.getElementById("paste").oninput = event => {
  result.textContent = event.target.value === pem ? "验证通过：复制内容逐字一致，换行完整保留" : "内容不一致";
};
</script></html>`;

const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(html);
});
server.listen(3199, "127.0.0.1", () => console.log("Synthetic clipboard test: http://0.0.0.0:3199"));
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
