import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, "..");

const child = spawnSync(process.execPath, ["--test", path.join(runtimeRoot, "tests", "smoke.test.mjs")], {
  cwd: runtimeRoot,
  stdio: "inherit",
  env: process.env,
});

if (typeof child.status === "number") {
  process.exitCode = child.status;
} else if (child.error) {
  console.error(`ERROR: failed to run smoke tests: ${child.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = 1;
}
