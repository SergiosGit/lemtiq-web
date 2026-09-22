import { createRemoteJWKSet, jwtVerify } from "jose";
import { refreshSnapshot } from "./refresh.js";

const keys = new Map();
async function authenticate(request, env) {
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD || !env.ADMIN_EMAIL) return false;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  if (!keys.has(env.ACCESS_ISSUER)) {
    keys.set(env.ACCESS_ISSUER, createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`)));
  }
  try {
    const { payload } = await jwtVerify(token, keys.get(env.ACCESS_ISSUER), {
      issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, algorithms: ["RS256"],
      requiredClaims: ["exp", "email"],
    });
    return payload.email === env.ADMIN_EMAIL;
  } catch {
    return false;
  }
}

export async function handleRequest(request, env, verify = authenticate, refresh = refreshSnapshot) {
  const url = new URL(request.url);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return new Response("Bad request", { status: 400 }); }
  // Reject ambiguous paths before passing requests to the static asset router.
  if (pathname.includes("\\") || pathname.includes("%") || pathname.split("/").some(p => p === "." || p === "..")) {
    return new Response("Bad request", { status: 400 });
  }
  pathname = pathname.replace(/\/+/g, "/");
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  if (!admin) return env.ASSETS.fetch(request);
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (url.hostname !== "lemtiq.com" || !(await verify(request, env))) {
    return new Response("Access denied", { status: 403, headers });
  }
  if (pathname === "/admin/api/refresh" && request.method === "POST") {
    if (request.headers.get("Origin") !== url.origin || request.headers.get("X-Dashboard-Refresh") !== "1") {
      return new Response("Access denied", { status: 403, headers });
    }
    try {
      const snapshot = await refresh(env);
      return Response.json(snapshot, { headers });
    } catch {
      return Response.json({ error: "Refresh failed. Existing snapshot retained. Check server configuration and retry." }, { status: 502, headers });
    }
  }
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers });
  if (pathname === "/admin") return new Response(null, { status: 302, headers: { ...headers, Location: "/admin/" } });
  if (pathname === "/admin/data/dashboard.json") {
    const snapshot = await env.DASHBOARD_DATA?.get("dashboard");
    if (!snapshot) return new Response("Dashboard snapshot not configured", { status: 503, headers });
    return new Response(request.method === "HEAD" ? null : snapshot, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  }
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export default { fetch: (request, env) => handleRequest(request, env) };
