function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function number(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function shortDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderRecent(rows) {
  const body = document.getElementById("recent-activity");
  body.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${shortDate(row.timestamp)}</td>
      <td>${escapeHtml(row.address || "Unknown")}</td>
      <td>${escapeHtml(row.engagement || "Engaged")}</td>
      <td>${escapeHtml(row.app_version || "-")}</td>
      <td>${number(row.session_count)}</td>
      <td>${row.system_kw ? `${row.system_kw.toFixed(1)} kW` : "-"}</td>
    `;
    body.appendChild(tr);
  }
}

function renderLocations(rows) {
  const list = document.getElementById("top-locations");
  list.innerHTML = "";
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "location-item";
    item.innerHTML = `<span>${escapeHtml(row.location)}</span><strong>${number(row.count)}</strong>`;
    list.appendChild(item);
  }
}

async function loadDashboard() {
  const response = await fetch("data/dashboard.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Dashboard snapshot not found.");
  const data = await response.json();
  renderDashboard(data);
}

function renderDashboard(data) {
  const suneyed = data.suneyed;

  setText("generated-at", shortDate(data.generated_at));
  setText("suneyed-users", number(suneyed.total_users));
  setText("suneyed-active", `${number(suneyed.active_7_days)} active in 7 days`);
  setText("suneyed-sessions", number(suneyed.total_sessions));
  setText("suneyed-pdfs", `${number(suneyed.total_pdfs_sent)} PDFs sent`);
  setText("wallet-created", number(data.wallet_business_card.passes_created));
  setText("wallet-status", data.wallet_business_card.status);
  setText("compliance-date", data.compliance.next_deadline);
  setText("compliance-item", data.compliance.next_item);
  setText("suneyed-source", data.sources.suneyed);
  setText("suneyed-active30", number(suneyed.active_30_days));
  setText("suneyed-download-only", number(suneyed.download_only_users));
  setText("suneyed-analysis", number(suneyed.users_with_analysis));
  setText("suneyed-system", `${suneyed.max_system_kw.toFixed(1)} kW`);
  setText("operating-focus", data.operating_model.current_focus);
  setText("approval-required", data.operating_model.approval_required);
  renderRecent(suneyed.recent_activity);
  renderLocations(suneyed.top_locations);
}

const refreshButton = document.getElementById("refresh-data");
const refreshStatus = document.getElementById("refresh-status");
refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing...";
  refreshStatus.textContent = "";
  try {
    const response = await fetch("/admin/api/refresh", { method: "POST", headers: { "X-Dashboard-Refresh": "1" } });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Refresh failed. Try signing in again or retry later.");
    renderDashboard(await response.json());
    refreshStatus.textContent = "Updated";
  } catch (error) { refreshStatus.textContent = error.message; }
  finally { refreshButton.disabled = false; refreshButton.textContent = "Refresh data"; }
});
loadDashboard().catch(() => { refreshStatus.textContent = "Dashboard unavailable. Try refreshing data."; });
