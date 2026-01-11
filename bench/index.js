import "./crarray.bench.js";
import "./crtext.bench.js";
import "./crregister.bench.js";
import "./crmap.bench.js";
import "./crset.bench.js";
import "./crrecord.bench.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import "./actor-integrity.bench.js";

async function runBench(script) {
  const benchDir = dirname(fileURLToPath(import.meta.url));
  const target = resolve(benchDir, script);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [target], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`bench ${script} exited with code ${code}`));
    });
  });
}

await runBench("access-reset.bench.js");
