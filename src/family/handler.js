// Family reunion planner: Access-gated page and JSON API under /family, backed by D1 binding FAMILY_DB.
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const DAY = 86400000;
const MAX_BODY = 8000;
const WINDOW_MONTHS = 15;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// FAMILY_MEMBERS is a Worker secret: {"email": "Party name", ...}. Kept out of the public repo.
export function familyMembers(env) {
  try {
    const parsed = JSON.parse(env.FAMILY_MEMBERS || "{}");
    return new Map(Object.entries(parsed).map(([email, party]) => [email.trim().toLowerCase(), String(party)]));
  } catch {
    return new Map();
  }
}

export async function handleFamily(request, env, pathname, identify, now = new Date()) {
  const members = familyMembers(env);
  const email = (await identify(request, env))?.toLowerCase();
  const party = email ? members.get(email) : undefined;
  if (!party) return new Response("Access denied", { status: 403, headers });
  const me = { party, admin: !!env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase() };
  if (pathname.startsWith("/family/api/")) {
    if (!env.FAMILY_DB) return Response.json({ error: "Family database not configured." }, { status: 503, headers });
    try {
      return Response.json(await api(request, env.FAMILY_DB, pathname.slice("/family/api/".length), me, members, now), { headers });
    } catch (error) {
      if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers });
      return Response.json({ error: "Request failed on the server." }, { status: 500, headers });
    }
  }
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers });
  if (pathname === "/family") return new Response(null, { status: 302, headers: { ...headers, Location: "/family/" } });
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

async function api(request, db, route, me, members, now) {
  const [resource, rawId, action, extra] = route.split("/");
  const method = request.method;
  const id = rawId === undefined ? undefined : /^\d{1,12}$/.test(rawId) ? Number(rawId) : NaN;
  if (extra !== undefined || Number.isNaN(id)) throw new HttpError(404, "Not found.");
  if (method === "GET" && resource === "state" && id === undefined) return state(db, me, members);
  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin || request.headers.get("X-Family-Request") !== "1") {
    throw new HttpError(403, "Access denied");
  }
  const stamp = now.toISOString();
  if (resource === "blocks" && !action) {
    if (method === "POST" && id === undefined) {
      const block = blockInput(await readJson(request), now);
      await db.prepare("INSERT INTO blocks (party, start_date, end_date, kind, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(me.party, block.start, block.end, block.kind, block.note, stamp, stamp).run();
      return state(db, me, members);
    }
    if (method === "PUT" && id !== undefined) {
      const block = blockInput(await readJson(request), now);
      await requireOwner(db, "blocks", id, me);
      await db.prepare("UPDATE blocks SET start_date = ?, end_date = ?, kind = ?, note = ?, updated_at = ? WHERE id = ?")
        .bind(block.start, block.end, block.kind, block.note, stamp, id).run();
      return state(db, me, members);
    }
    if (method === "DELETE" && id !== undefined) {
      await requireOwner(db, "blocks", id, me);
      await db.prepare("DELETE FROM blocks WHERE id = ?").bind(id).run();
      return state(db, me, members);
    }
  }
  if (resource === "proposals") {
    if (method === "POST" && id === undefined && !action) {
      const body = await readJson(request);
      await db.prepare("INSERT INTO proposals (party, title, url, description, cost_hint, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(me.party, text(body.title, 120, "title", true), link(body.url), text(body.description, 2000, "description"), text(body.cost_hint, 120, "cost"), stamp).run();
      return state(db, me, members);
    }
    if (method === "DELETE" && id !== undefined && !action) {
      await requireOwner(db, "proposals", id, me);
      await db.batch([
        db.prepare("DELETE FROM comments WHERE proposal_id = ?").bind(id),
        db.prepare("DELETE FROM reactions WHERE proposal_id = ?").bind(id),
        db.prepare("DELETE FROM proposals WHERE id = ?").bind(id),
      ]);
      return state(db, me, members);
    }
    if (method === "POST" && id !== undefined && action === "comments") {
      const body = await readJson(request);
      await requireExists(db, id);
      await db.prepare("INSERT INTO comments (proposal_id, party, body, created_at) VALUES (?, ?, ?, ?)")
        .bind(id, me.party, text(body.body, 2000, "comment", true), stamp).run();
      return state(db, me, members);
    }
    if (method === "POST" && id !== undefined && action === "react") {
      await requireExists(db, id);
      const removed = await db.prepare("DELETE FROM reactions WHERE proposal_id = ? AND party = ?").bind(id, me.party).run();
      if (!removed.meta?.changes) await db.prepare("INSERT INTO reactions (proposal_id, party) VALUES (?, ?)").bind(id, me.party).run();
      return state(db, me, members);
    }
  }
  if (resource === "comments" && method === "DELETE" && id !== undefined && !action) {
    await requireOwner(db, "comments", id, me);
    await db.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
    return state(db, me, members);
  }
  if (resource === "chosen" && method === "PUT" && id === undefined) {
    if (!me.admin) throw new HttpError(403, "Only the organizer can set the chosen dates.");
    const body = await readJson(request);
    if (body.clear === true) {
      await db.prepare("DELETE FROM settings WHERE key = 'chosen'").run();
    } else {
      const range = dateRange(body, now);
      const chosen = JSON.stringify({ ...range, label: text(body.label, 120, "label") });
      await db.prepare("INSERT INTO settings (key, value) VALUES ('chosen', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(chosen).run();
    }
    return state(db, me, members);
  }
  throw new HttpError(404, "Not found.");
}

async function state(db, me, members) {
  const [blocks, proposals, comments, reactions, chosen] = await db.batch([
    db.prepare("SELECT id, party, start_date AS start, end_date AS end, kind, note FROM blocks ORDER BY start_date, id"),
    db.prepare("SELECT id, party, title, url, description, cost_hint, created_at FROM proposals ORDER BY created_at DESC, id DESC"),
    db.prepare("SELECT id, proposal_id, party, body, created_at FROM comments ORDER BY created_at, id"),
    db.prepare("SELECT proposal_id, party FROM reactions ORDER BY party"),
    db.prepare("SELECT value FROM settings WHERE key = 'chosen'"),
  ]);
  const byProposal = new Map(proposals.results.map(p => [p.id, { ...p, comments: [], reactions: [] }]));
  for (const c of comments.results) byProposal.get(c.proposal_id)?.comments.push(c);
  for (const r of reactions.results) byProposal.get(r.proposal_id)?.reactions.push(r.party);
  const saved = chosen.results[0]?.value;
  return {
    me: me.party,
    admin: me.admin,
    parties: [...new Set(members.values())],
    blocks: blocks.results,
    proposals: [...byProposal.values()],
    chosen: saved ? JSON.parse(saved) : null,
  };
}

async function requireOwner(db, table, id, me) {
  const row = await db.prepare(`SELECT party FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw new HttpError(404, "Not found.");
  if (row.party !== me.party) throw new HttpError(403, "You can only change your own entries.");
}

async function requireExists(db, id) {
  if (!(await db.prepare("SELECT id FROM proposals WHERE id = ?").bind(id).first())) throw new HttpError(404, "Not found.");
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, "Request too large.");
  try {
    const body = JSON.parse(raw || "{}");
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new HttpError(400, "Invalid JSON.");
}

function blockInput(body, now) {
  if (!["hard", "soft"].includes(body.kind)) throw new HttpError(400, "Invalid kind.");
  return { ...dateRange(body, now), kind: body.kind, note: text(body.note, 200, "note") };
}

function isoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function addMonths(iso, months) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

// Rolling WINDOW_MONTHS window; one day of slack either side covers viewer time zones.
export function dateRange(body, now) {
  const start = isoDate(body.start), end = isoDate(body.end);
  if (!start || !end || start > end) throw new HttpError(400, "Invalid dates.");
  const today = now.toISOString().slice(0, 10);
  if (end < addDays(today, -1) || start > addDays(addMonths(today, WINDOW_MONTHS), 1)) throw new HttpError(400, `Dates must fall within the next ${WINDOW_MONTHS} months.`);
  return { start, end };
}

function text(value, max, field, required = false) {
  const result = typeof value === "string" ? value.trim() : value == null ? "" : null;
  if (result === null || result.length > max || (required && !result)) throw new HttpError(400, `Invalid ${field}.`);
  return result;
}

function link(value) {
  const raw = text(value, 500, "link");
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { throw new HttpError(400, "Invalid link."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new HttpError(400, "Links must start with http:// or https://.");
  return url.href;
}
