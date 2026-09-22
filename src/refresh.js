import { importPKCS8, SignJWT } from "jose";
import { mapRows } from "./suneyed-rows.js";
import { suneyedSummary } from "./suneyed-summary.js";

export function decodeValue(value) {
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("mapValue" in value) return decodeFields(value.mapValue.fields);
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  return null;
}
function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}
async function jsonFetch(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Upstream request failed (${response.status})`);
  return response.json();
}

export async function refreshSnapshot(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON || !env.DASHBOARD_DATA) throw new Error("Refresh is not configured");
  const previous = await env.DASHBOARD_DATA.get("dashboard", "json");
  if (!previous) throw new Error("Initial dashboard snapshot is missing");
  const credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const key = await importPKCS8(credentials.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/datastore" })
    .setProtectedHeader({ alg: "RS256" }).setIssuer(credentials.client_email)
    .setAudience("https://oauth2.googleapis.com/token").setIssuedAt().setExpirationTime("5m").sign(key);
  const token = await jsonFetch("https://oauth2.googleapis.com/token", {
    method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!token.access_token) throw new Error("Google authentication failed");
  const root = `projects/${encodeURIComponent(credentials.project_id)}/databases/(default)/documents`;
  async function query(collectionId, allDescendants) {
    const result = await jsonFetch(`https://firestore.googleapis.com/v1/${root}:runQuery`, {
      method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants }] } }),
    });
    return result.filter(row => row.document).map(row => row.document);
  }
  // Two queries avoid one HTTP subrequest per user's event collection.
  const users = await query("users", false);
  const events = await query("events", true);
  const byUser = new Map(users.map(doc => [doc.name, { user_id: doc.name.split("/").at(-1), data: decodeFields(doc.fields), events: [] }]));
  for (const doc of events) {
    const parent = doc.name.split("/").slice(0, -2).join("/");
    byUser.get(parent)?.events.push(decodeFields(doc.fields));
  }
  const cache = await env.DASHBOARD_DATA.get("geocode-cache", "json") || {};
  let geocodeCount = 0;
  let queue = Promise.resolve();
  const geocoder = { getAddress(lat, lon) {
    const task = queue.then(async () => {
      const coordinate = `${Number(lat.toFixed(5))},${Number(lon.toFixed(5))}`;
      if (cache[coordinate]) return cache[coordinate];
      if (++geocodeCount > 30) throw new Error("Geocode cache needs initialization");
      await new Promise(resolve => setTimeout(resolve, 1100));
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.search = new URLSearchParams({ lat: String(lat), lon: String(lon), format: "jsonv2", zoom: "18", addressdetails: "1" });
      const result = await jsonFetch(url, { headers: { "User-Agent": "lemtiq-dashboard/0.1 (info@lemtiq.com)" } });
      cache[coordinate] = result.display_name || "Unknown address";
      return cache[coordinate];
    });
    queue = task;
    return task;
  } };
  const rows = await mapRows([...byUser.values()], geocoder);
  const snapshot = { ...previous, generated_at: new Date().toISOString(), suneyed: suneyedSummary(rows) };
  await env.DASHBOARD_DATA.put("geocode-cache", JSON.stringify(cache));
  await env.DASHBOARD_DATA.put("dashboard", JSON.stringify(snapshot));
  return snapshot;
}
