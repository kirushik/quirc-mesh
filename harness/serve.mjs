// Minimal static file server for local dev (so camera.html can load ES modules
// and getUserMedia runs in a secure context — localhost counts as secure).
//
//   node harness/serve.mjs            # serves project root on http://localhost:8000
//   node harness/serve.mjs 8080       # custom port
// then open http://localhost:8000/harness/camera.html

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 8000;

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".wasm": "application/wasm",
  ".css": "text/css", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  if (urlPath.endsWith("/")) filePath = path.join(filePath, "index.html");

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404).end("not found: " + urlPath); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`serving ${ROOT}`);
  console.log(`open  http://localhost:${PORT}/harness/camera.html`);
});
