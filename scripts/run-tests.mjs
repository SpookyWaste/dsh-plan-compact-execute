// Run every test-*.mjs in test/, in name order, one child process each, and exit
// non-zero when any suite fails. One entry point shared by the local loop and CI;
// no shell glob semantics involved. `test/bundle.mjs` and `test/session.mjs` are
// harness fixtures rather than suites, so the `test-` prefix is what separates a
// suite from a fixture.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const suitesDir = fileURLToPath(new URL("../test/", import.meta.url));
const suites = readdirSync(suitesDir)
  .filter((name) => name.startsWith("test-") && name.endsWith(".mjs"))
  .sort();

if (suites.length === 0) {
  console.error("run-tests: no test-*.mjs found in test/");
  process.exit(1);
}

const failed = [];
for (const suite of suites) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../test/${suite}`, import.meta.url))], {
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