import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "./worker.js";
const env = {
  ASSETS: { fetch: async () => new Response("asset") },
  DASHBOARD_DATA: { get: async () => '{"generated_at":"test"}' },
};
test("public home remains public", async () => {
  assert.equal(await (await handleRequest(new Request("https://lemtiq.com/"), env)).text(), "asset");
});
test("all admin paths deny missing or forged credentials", async () => {
  for (const path of ["/admin", "/admin/", "/admin/index.html", "/admin/data/dashboard.json", "/%61dmin/data/dashboard.json", "//admin/"]) {
    const response = await handleRequest(new Request(`https://lemtiq.com${path}`, { headers: { "Cf-Access-Jwt-Assertion": "forged" } }), env);
    assert.equal(response.status, 403, path);
  }
});
test("alternate hostname cannot serve admin even with approved identity", async () => {
  const response = await handleRequest(new Request("https://lemtiq-web.weakinteraction.workers.dev/admin/"), env, async () => true);
  assert.equal(response.status, 403);
});
test("authenticated data is private and missing binding fails closed", async () => {
  const request = new Request("https://lemtiq.com/admin/data/dashboard.json");
  const response = await handleRequest(request, env, async () => true);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.equal((await response.json()).generated_at, "test");
  assert.equal((await handleRequest(request, { ASSETS: env.ASSETS }, async () => true)).status, 503);
});
test("admin canonical redirect and shell are uncached", async () => {
  const redirect = await handleRequest(new Request("https://lemtiq.com/admin"), env, async () => true);
  assert.equal(redirect.headers.get("Location"), "/admin/");
  const shell = await handleRequest(new Request("https://lemtiq.com/admin/"), env, async () => true);
  assert.equal(await shell.text(), "asset");
  assert.match(shell.headers.get("Cache-Control"), /no-store/);
});
