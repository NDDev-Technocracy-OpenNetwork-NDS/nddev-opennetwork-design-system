// Serve the standalone web package, including its bundled fonts, on loopback.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { ROOT } from "../src/dtcg.ts";

const root = resolve(ROOT, "packages/web");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
createServer((req, res) => {
  let name: string;
  try {
    name = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = resolve(root, "." + (name === "/" ? "/reference.html" : name));
  try {
    if (!file.startsWith(root + sep) || !statSync(file).isFile())
      throw new Error("Not found");
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
}).listen(4870, "127.0.0.1");
