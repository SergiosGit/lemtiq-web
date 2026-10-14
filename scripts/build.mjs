import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const out = new URL("dist/", root);
await rm(out, { recursive: true, force: true });
await mkdir(new URL("admin/", out), { recursive: true });
await mkdir(new URL("family/", out), { recursive: true });
// Explicit allowlist excludes snapshots, credentials, and repository metadata.
for (const name of ["index.html", "css", "_redirects", "admin/index.html", "admin/app.js", "admin/styles.css",
  "family/index.html", "family/app.js", "family/i18n.js", "family/styles.css"]) {
  await cp(new URL(name, root), new URL(name, out), { recursive: true });
}
console.log(`Built public assets, admin shell and family planner in ${fileURLToPath(out)}`);
