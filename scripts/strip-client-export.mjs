// Post-build step: the browser bundle must stay a classic script.
//
// `moduleDetection: "auto"` plus package.json `"type": "module"` makes tsc treat
// src/client.ts as a module even though it has no import/export statement, so
// the emitted lib/client.js ends with a bare `export {};` that would be a
// SyntaxError when the host loads the bundle as a classic script. Strip exactly
// that trailing statement and fail loudly if the bundle shape ever changes.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const source = readFileSync(file, "utf8");
const stripped = source.replace(/\nexport \{\};\s*$/, "\n");
if (stripped === source) {
  console.error("strip-client-export: no trailing 'export {};' found — bundle shape changed unexpectedly");
  process.exit(1);
}
writeFileSync(file, stripped);
console.log("strip-client-export: removed the trailing export from lib/client.js");