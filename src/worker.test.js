import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "./worker.js";
import { decodeValue } from "./refresh.js";
const env = {
  ASSETS: { fetch: async () => new Response("asset") },
  DASHBOARD_DATA: { get: async () => '{"generated_at":"test"}' },
};
test("refresh requires login and same-origin request", async () => {
  const request = new Request("https://lemtiq.com/admin/api/refresh", { method: "POST" });
  let calls = 0;
  const refresh = async () => { calls++; return { generated_at: "fresh" }; };
  assert.equal((await handleRequest(request, env, async () => false, refresh)).status, 403);
  assert.equal((await handleRequest(request, env, async () => true, refresh)).status, 403);
  assert.equal(calls, 0);
  const valid = new Request(request, { headers: { Origin: "https://lemtiq.com", "X-Dashboard-Refresh": "1" } });
  const response = await handleRequest(valid, env, async () => true, refresh);
  assert.equal((await response.json()).generated_at, "fresh");
  assert.equal(calls, 1);
  const failed = await handleRequest(valid, env, async () => true, async () => { throw new Error("private key details"); });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /private key/);
});
test("Firestore REST values preserve numbers and event timestamps", () => {
  assert.equal(decodeValue({ integerValue: "3" }), 3);
  assert.equal(decodeValue({ timestampValue: "2026-09-22T00:00:00Z" }), "2026-09-22T00:00:00Z");
  assert.deepEqual(decodeValue({ mapValue: { fields: { lat: { doubleValue: 43.1 } } } }), { lat: 43.1 });
});
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
