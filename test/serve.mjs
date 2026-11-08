// Локальний сервер: API + статичний додаток на одному порту
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { createCore } from "../functions/trainer/src/core.js"; import { memStore } from "./mem.mjs";
const core = createCore(memStore(), { iterations: 1000, tgFetch: async () => ({ json: async () => ({ ok: true, result: { username: "t_bot" } }) }) });
const dir = process.argv[2];
http.createServer(async (req, res) => {
  if (req.url.startsWith("/api")) {
    let b = ""; for await (const c of req) b += c;
    const [code, j] = await core.api(JSON.parse(b || "{}"), req.headers, { ip: "1", baseUrl: "http://x" });
    res.writeHead(code, { "content-type": "application/json" }); return res.end(JSON.stringify(j));
  }
  const f = path.join(dir, req.url.split("?")[0].split("#")[0] === "/" ? "index.html" : req.url.split("?")[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const t = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(f)] || "application/octet-stream";
  res.writeHead(200, { "content-type": t + "; charset=utf-8" }); fs.createReadStream(f).pipe(res);
}).listen(8899);
