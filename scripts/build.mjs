import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const out = new URL("dist/", root);
await rm(out, { recursive: true, force: true });
await mkdir(new URL("admin/", out), { recursive: true });
// Explicit allowlist excludes snapshots, credentials, and repository metadata.
for (const name of ["index.html", "css", "_redirects", "admin/index.html", "admin/app.js", "admin/styles.css"]) {
  await cp(new URL(name, root), new URL(name, out), { recursive: true });
}
console.log(`Built public assets and admin shell in ${fileURLToPath(out)}`);
