const DEFAULT_SUNEYED_LATITUDE = 43.038902;
const DEFAULT_SUNEYED_LONGITUDE = -89.906471;
const DEFAULT_LOCATION_TOLERANCE = 0.0002;

function number(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + number(row[field]), 0);
}

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function bucketByVersion(rows) {
  const counts = new Map();
  for (const row of rows) {
    const version = row.app_version || "unknown";
    counts.set(version, (counts.get(version) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([version, count]) => ({ version, count }))
    .sort((left, right) => right.count - left.count || left.version.localeCompare(right.version));
}

function topLocations(rows) {
  const counts = new Map();
  for (const row of rows) {
    const location = dashboardLocation(row);
    counts.set(location, (counts.get(location) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([location, count]) => ({ location, count }))
    .sort((left, right) => right.count - left.count || left.location.localeCompare(right.location));
}

function recentRows(rows) {
  return rows.slice(0, 8).map((row) => ({
    timestamp: row.timestamp,
    address: dashboardLocation(row),
    engagement: engagementLabel(row),
    app_version: row.app_version,
    session_count: row.session_count,
    pdf_sent_count: row.pdf_sent_count,
    system_kw: row.system_kw,
    annual_savings: row.annual_savings,
    break_even_years: row.break_even_years,
  }));
}

function isDefaultSuneyedLocation(row) {
  return (
    Math.abs(number(row.latitude) - DEFAULT_SUNEYED_LATITUDE) <= DEFAULT_LOCATION_TOLERANCE
    && Math.abs(number(row.longitude) - DEFAULT_SUNEYED_LONGITUDE) <= DEFAULT_LOCATION_TOLERANCE
  );
}

function isDownloadOnly(row) {
  return row.event_count === 0 && isDefaultSuneyedLocation(row);
}

function engagementLabel(row) {
  return isDownloadOnly(row) ? "Download only" : "Engaged";
}

function dashboardLocation(row) {
  if (isDownloadOnly(row)) return "Download only";
  return approximateLocation(row.address);
}

function approximateLocation(address) {
  if (!address) return "Unknown";
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 4) return parts.join(", ");
  return parts.slice(-4).join(", ");
}

function suneyedSummary(rows) {
  const sevenDays = daysAgo(7);
  const thirtyDays = daysAgo(30);
  const active7 = rows.filter((row) => {
    const date = parseDate(row.timestamp);
    return date && date >= sevenDays;
  });
  const active30 = rows.filter((row) => {
    const date = parseDate(row.timestamp);
    return date && date >= thirtyDays;
  });
  const withAnalysis = rows.filter((row) => Number.isFinite(row.annual_savings) || Number.isFinite(row.system_kw));

  return {
    total_users: rows.length,
    download_only_users: rows.filter(isDownloadOnly).length,
    engaged_users: rows.filter((row) => !isDownloadOnly(row)).length,
    active_7_days: active7.length,
    active_30_days: active30.length,
    total_sessions: sum(rows, "session_count"),
    total_pdfs_sent: sum(rows, "pdf_sent_count"),
    total_locations: sum(rows, "location_count"),
    users_with_analysis: withAnalysis.length,
    max_system_kw: Math.max(0, ...rows.map((row) => number(row.system_kw))),
    app_versions: bucketByVersion(rows),
    top_locations: topLocations(rows),
    recent_activity: recentRows(rows),
  };
}


export { suneyedSummary };
