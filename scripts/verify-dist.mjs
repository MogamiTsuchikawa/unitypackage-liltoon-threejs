// Vite copies public/ verbatim. Reject accidental test models, captures, and
// other extra files before uploading dist/ to Workers.
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const expected = new Set([
  "index.html", "mark.svg",
  "licenses/three-liltoon.txt", "licenses/three-liltoon-notices.md",
  "licenses/three.txt", "licenses/yaml.txt",
]);
const bundle = /^assets\/[\w.-]+-[\w-]{8,}\.(?:js|css)$/;
let count = 0;
async function check(prefix = "") {
  for (const entry of await readdir(path.join(dist, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) { await check(name + "/"); continue; }
    if (!entry.isFile() || (!expected.delete(name) && !bundle.test(name))) {
      throw new Error("Unexpected deployment file: " + name);
    }
    count++;
  }
}
await check();
if (expected.size) throw new Error("Missing deployment files: " + [...expected].join(", "));
console.log("Verified " + count + " deployment files (app, bundles, and licenses).");
