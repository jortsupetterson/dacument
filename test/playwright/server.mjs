import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT ?? 4173);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);

function resolvePath(urlPath) {
  const normalized = urlPath === "/" ? "/test/playwright/index.html" : urlPath;
  return path.resolve(root, "." + normalized);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const filePath = resolvePath(decodeURIComponent(url.pathname));
    if (!filePath.startsWith(root)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    let resolvedPath = filePath;
    if (stat.isDirectory()) {
      resolvedPath = path.join(filePath, "index.html");
      try {
        await fs.access(resolvedPath);
      } catch {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
    }

    const ext = path.extname(resolvedPath);
    res.setHeader("Content-Type", contentTypes.get(ext) ?? "application/octet-stream");
    res.end(await fs.readFile(resolvedPath));
  } catch (error) {
    res.statusCode = 500;
    res.end(error instanceof Error ? error.message : "Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Playwright server listening on http://127.0.0.1:${port}`);
});
