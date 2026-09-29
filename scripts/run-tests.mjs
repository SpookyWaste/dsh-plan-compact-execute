// Run every test-*.mjs in the repository root, in name order, one child process
// each, and exit non-zero when any suite fails. One entry point shared by the
// local loop and CI; no shell glob semantics involved.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const suites = readdirSync(root)
  .filter((name) => name.startsWith("test-") && name.endsWith(".mjs"))
  .sort();

if (suites.length === 0) {
  console.error("run-tests: no test-*.mjs found in the repository root");
  process.exit(1);
}

const failed = [];
for (const suite of suites) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../${suite}`, import.meta.url))], {
    stdio: "inherit",
  });
  const ok = result.status === 0;
  if (!ok) failed.push(suite);
  console.log(`${ok ? "ok  " : "FAIL"}  ${suite}`);
}

console.log(`\n${suites.length - failed.length}/${suites.length} suites passed`);
if (failed.length > 0) {
  console.error(`failed: ${failed.join(", ")}`);
  process.exit(1);
}