import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleRequest } from "../worker.js";

// Minimal D1 stand-in over node:sqlite, running the real schema.
function memoryD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    all: async () => ({ results: db.prepare(sql).all(...args).map(row => ({ ...row })) }),
    first: async () => { const row = db.prepare(sql).get(...args); return row ? { ...row } : null; },
    run: async () => { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
  });
  return { prepare: sql => statement(sql), batch: async list => Promise.all(list.map(s => s.all())) };
}

function setup() {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    FAMILY_DB: memoryD1(),
    ADMIN_EMAIL: "organizer@example.com",
    FAMILY_MEMBERS: JSON.stringify({ "organizer@example.com": "Ada", "Bea@Example.com": "Bea" }),
  };
}

const as = email => async () => email;
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
function call(env, email, path, method = "GET", body, extraHeaders = { Origin: "https://lemtiq.com", "X-Family-Request": "1" }) {
  const init = { method, headers: method === "GET" ? {} : extraHeaders };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handleRequest(new Request(`https://lemtiq.com${path}`, init), env, undefined, undefined, as(email));
}

test("family pages and API deny anonymous and unlisted users", async () => {
  const env = setup();
  for (const path of ["/family", "/family/", "/family/index.html", "/family/api/state"]) {
    assert.equal((await call(env, null, path)).status, 403, path);
    assert.equal((await call(env, "stranger@example.com", path)).status, 403, path);
  }
  const shell = await call(env, "bea@example.com", "/family/");
  assert.equal(await shell.text(), "asset");
  assert.match(shell.headers.get("Cache-Control"), /no-store/);
  assert.match(shell.headers.get("X-Robots-Tag"), /noindex/);
});

test("default identity fails closed off lemtiq.com and without a token", async () => {
  const env = { ...setup(), ACCESS_ISSUER: "https://example.cloudflareaccess.com", FAMILY_ACCESS_AUD: "aud" };
  assert.equal((await handleRequest(new Request("https://lemtiq.com/family/api/state"), env)).status, 403);
  assert.equal((await handleRequest(new Request("https://lemtiq-web.weakinteraction.workers.dev/family/"), env)).status, 403);
  const dev = { ...env, FAMILY_DEV_EMAIL: "bea@example.com" };
  assert.equal((await handleRequest(new Request("https://lemtiq.com/family/"), dev)).status, 403);
  assert.equal((await handleRequest(new Request("http://localhost:8787/family/"), dev)).status, 200);
});

test("state lists parties from the secret and the signed-in party", async () => {
  const state = await (await call(setup(), "BEA@example.com", "/family/api/state")).json();
  assert.equal(state.me, "Bea");
  assert.equal(state.admin, false);
  assert.deepEqual(state.parties, ["Ada", "Bea"]);
});

test("writes require same-origin request header", async () => {
  const env = setup();
  const block = { start: day(10), end: day(12), kind: "hard" };
  assert.equal((await call(env, "bea@example.com", "/family/api/blocks", "POST", block, {})).status, 403);
  assert.equal((await call(env, "bea@example.com", "/family/api/blocks", "POST", block, { Origin: "https://evil.example", "X-Family-Request": "1" })).status, 403);
  assert.equal((await call(env, "bea@example.com", "/family/api/blocks", "POST", block)).status, 200);
});

test("parties can only change their own blocks", async () => {
  const env = setup();
  const created = await (await call(env, "bea@example.com", "/family/api/blocks", "POST", { start: day(10), end: day(12), kind: "soft", note: "Trip" })).json();
  const { id, party, note } = created.blocks[0];
  assert.deepEqual([party, note], ["Bea", "Trip"]);
  const edit = { start: day(11), end: day(13), kind: "hard" };
  assert.equal((await call(env, "organizer@example.com", `/family/api/blocks/${id}`, "PUT", edit)).status, 403);
  assert.equal((await call(env, "organizer@example.com", `/family/api/blocks/${id}`, "DELETE")).status, 403);
  const updated = await (await call(env, "bea@example.com", `/family/api/blocks/${id}`, "PUT", edit)).json();
  assert.equal(updated.blocks[0].start, day(11));
  assert.equal((await (await call(env, "bea@example.com", `/family/api/blocks/${id}`, "DELETE")).json()).blocks.length, 0);
});

test("invalid dates, kinds and links are rejected", async () => {
  const env = setup();
  for (const block of [
    { start: day(12), end: day(10), kind: "hard" },
    { start: "2026-02-30", end: "2026-03-01", kind: "hard" },
    { start: day(-30), end: day(-20), kind: "hard" },
    { start: day(470), end: day(471), kind: "hard" },
    { start: day(10), end: day(12), kind: "maybe" },
  ]) {
    assert.equal((await call(env, "bea@example.com", "/family/api/blocks", "POST", block)).status, 400, JSON.stringify(block));
  }
  assert.equal((await call(env, "bea@example.com", "/family/api/blocks", "POST", { start: day(440), end: day(445), kind: "hard" })).status, 200);
  const bad = await call(env, "bea@example.com", "/family/api/proposals", "POST", { title: "X", url: "javascript:alert(1)" });
  assert.equal(bad.status, 400);
  assert.equal((await call(env, "bea@example.com", "/family/api/proposals", "POST", { title: "  " })).status, 400);
});

test("proposals collect comments and toggled reactions", async () => {
  const env = setup();
  const created = await (await call(env, "bea@example.com", "/family/api/proposals", "POST", { title: "Lake house", url: "https://example.com/lake", cost_hint: "~$200/night" })).json();
  const id = created.proposals[0].id;
  await call(env, "organizer@example.com", `/family/api/proposals/${id}/comments`, "POST", { body: "Love it" });
  let state = await (await call(env, "organizer@example.com", `/family/api/proposals/${id}/react`, "POST")).json();
  assert.deepEqual(state.proposals[0].reactions, ["Ada"]);
  assert.equal(state.proposals[0].comments[0].body, "Love it");
  state = await (await call(env, "organizer@example.com", `/family/api/proposals/${id}/react`, "POST")).json();
  assert.deepEqual(state.proposals[0].reactions, []);
  const commentId = state.proposals[0].comments[0].id;
  assert.equal((await call(env, "bea@example.com", `/family/api/comments/${commentId}`, "DELETE")).status, 403);
  assert.equal((await call(env, "organizer@example.com", `/family/api/proposals/${id}`, "DELETE")).status, 403);
  assert.equal((await (await call(env, "bea@example.com", `/family/api/proposals/${id}`, "DELETE")).json()).proposals.length, 0);
});

test("only the organizer sets the chosen dates", async () => {
  const env = setup();
  const chosen = { start: day(100), end: day(105), label: "Reunion" };
  assert.equal((await call(env, "bea@example.com", "/family/api/chosen", "PUT", chosen)).status, 403);
  const state = await (await call(env, "organizer@example.com", "/family/api/chosen", "PUT", chosen)).json();
  assert.deepEqual(state.chosen, chosen);
  assert.equal((await (await call(env, "organizer@example.com", "/family/api/chosen", "PUT", { clear: true })).json()).chosen, null);
});

test("missing database binding fails closed", async () => {
  const env = { ...setup(), FAMILY_DB: undefined };
  assert.equal((await call(env, "bea@example.com", "/family/api/state")).status, 503);
});
