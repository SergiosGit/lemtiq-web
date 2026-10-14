const DAY = 86400000;
const WINDOW_MONTHS = 15;
const COLORS = ["#4f46e5", "#0f766e", "#b45309", "#be123c", "#7c3aed", "#0369a1"];
const MIN_LENGTHS = [1, 2, 3, 4, 5, 7, 10, 14];

let lang = readPref("family-lang") || (navigator.language?.startsWith("de") ? "de" : "en");
let state = null;
let editing = null;
const view = { minLength: Number(readPref("family-min")) || 4, countSoft: readPref("family-soft") === "1" };

function readPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function t(key, vars = {}) {
  return (I18N[lang][key] ?? I18N.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}

// Dates stay ISO strings and UTC day numbers so daylight-saving changes never shift a bar.
const pad = n => String(n).padStart(2, "0");
const dayNum = iso => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoOf = n => new Date(n * DAY).toISOString().slice(0, 10);
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
const START = dayNum(localToday());
const DAYS = (() => {
  const end = new Date(`${localToday()}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + WINDOW_MONTHS);
  return dayNum(end.toISOString().slice(0, 10)) - START + 1;
})();
const index = iso => dayNum(iso) - START;
const pct = days => `${(days / DAYS) * 100}%`;

function fmt(iso, options = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat(t("locale"), { ...options, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function fmtRange(start, end) {
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

function lengthText(n) {
  return n === 1 ? t("day") : t("days", { n });
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, v);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat(Infinity).filter(child => child != null && child !== false));
  return node;
}

function setStatus(message, error = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("error", error);
}

async function api(path, method = "GET", body) {
  let response;
  try {
    response = await fetch(`api/${path}`, {
      method,
      cache: "no-store",
      redirect: "manual",
      headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-Family-Request": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(t("errConnection"));
  }
  if (response.type === "opaqueredirect" || [301, 302, 303, 307, 308, 401].includes(response.status)) throw new Error(t("errSession"));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || t("errGeneric"));
  return data;
}

async function mutate(path, method, body) {
  try {
    state = await api(path, method, body);
    setStatus("");
    render();
    return true;
  } catch (error) {
    setStatus(error.message, true);
    return false;
  }
}

async function remove(path) {
  if (confirm(t("confirmDelete"))) await mutate(path, "DELETE");
}

async function dialogMutate(id, path, method, body) {
  const dialog = document.getElementById(id);
  const error = dialog.querySelector(".dialog-error");
  error.textContent = "";
  try {
    state = await api(path, method, body);
    render();
    dialog.close();
  } catch (e) {
    error.textContent = e.message;
  }
}

const colorOf = party => COLORS[Math.max(0, state.parties.indexOf(party)) % COLORS.length];

function span(start, end) {
  const s = Math.max(0, index(start)), e = Math.min(DAYS - 1, index(end));
  return e < 0 || s >= DAYS || e < s ? null : { s, e };
}

function freeWindows() {
  const blocked = new Uint8Array(DAYS);
  for (const block of state.blocks) {
    if (block.kind === "soft" && !view.countSoft) continue;
    const range = span(block.start, block.end);
    if (range) blocked.fill(1, range.s, range.e + 1);
  }
  const windows = [];
  for (let i = 0; i < DAYS; i++) {
    if (blocked[i]) continue;
    let j = i;
    while (j + 1 < DAYS && !blocked[j + 1]) j++;
    if (j - i + 1 >= view.minLength) windows.push({ s: i, e: j, start: isoOf(START + i), end: isoOf(START + j) });
    i = j;
  }
  return windows;
}

function monthStarts() {
  const months = [];
  for (let i = 0; i < DAYS; i++) {
    const iso = isoOf(START + i);
    if (i > 0 && !iso.endsWith("-01")) continue;
    const withYear = i === 0 || iso.slice(5, 7) === "01";
    months.push({ i, label: fmt(iso, withYear ? { month: "short", year: "numeric" } : { month: "short" }) });
  }
  // Drop the partial first month's label when the next month starts too close to fit it.
  if (months.length > 1 && months[1].i < 20) months[0].label = "";
  return months;
}

function backdrop(months) {
  const chosen = state.chosen && span(state.chosen.start, state.chosen.end);
  return [
    months.filter(m => m.i > 0).map(m => el("i", { class: "g-line", style: { left: pct(m.i) } })),
    chosen ? el("i", { class: "chosen-band", style: { left: pct(chosen.s), width: pct(chosen.e - chosen.s + 1) } }) : null,
  ];
}

function bar(block, mine) {
  const range = span(block.start, block.end);
  if (!range) return null;
  const kind = t(block.kind === "hard" ? "kindHard" : "kindSoft");
  const label = `${block.party}: ${fmtRange(block.start, block.end)} · ${kind}${block.note ? ` · ${block.note}` : ""}`;
  return el(mine ? "button" : "div", {
    type: mine ? "button" : null,
    role: mine ? null : "img",
    class: `bar ${block.kind}`,
    style: { left: pct(range.s), width: pct(range.e - range.s + 1) },
    title: label,
    "aria-label": label,
    onclick: mine ? () => openBlock(block) : null,
    onpointerdown: mine ? event => event.stopPropagation() : null,
  }, block.note);
}

function enableDrag(track) {
  let anchor = null;
  const preview = el("i", { class: "bar preview" });
  const dayAt = event => {
    const rect = track.getBoundingClientRect();
    return Math.min(DAYS - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * DAYS)));
  };
  const update = day => {
    const s = Math.min(anchor, day), e = Math.max(anchor, day);
    preview.style.left = pct(s);
    preview.style.width = pct(e - s + 1);
    return [s, e];
  };
  track.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    anchor = dayAt(event);
    track.setPointerCapture(event.pointerId);
    track.append(preview);
    update(anchor);
  });
  track.addEventListener("pointermove", event => { if (anchor !== null) update(dayAt(event)); });
  track.addEventListener("pointerup", event => {
    if (anchor === null) return;
    const [s, e] = update(dayAt(event));
    anchor = null;
    preview.remove();
    openBlock(null, isoOf(START + s), isoOf(START + e));
  });
  track.addEventListener("pointercancel", () => { anchor = null; preview.remove(); });
}

function renderGantt() {
  const months = monthStarts();
  const header = el("div", { class: "g-row g-head" },
    el("div", { class: "g-label" }),
    el("div", { class: "g-track" }, months.map(m => el("span", { class: "g-month", style: { left: pct(m.i) } }, m.label))));
  const rows = state.parties.map(party => {
    const mine = party === state.me;
    const blocks = state.blocks.filter(block => block.party === party);
    const track = el("div", { class: `g-track${mine ? " mine" : ""}`, style: { "--c": colorOf(party) } },
      backdrop(months), blocks.map(block => bar(block, mine)));
    if (mine) enableDrag(track);
    return el("div", { class: "g-row" },
      el("div", { class: "g-label" },
        el("span", {}, el("i", { class: "dot", style: { background: colorOf(party) } }), party, mine ? ` (${t("you")})` : ""),
        blocks.length ? null : el("small", {}, t("noEntries"))),
      track);
  });
  const free = el("div", { class: "g-row free-row" },
    el("div", { class: "g-label" }, el("span", {}, t("everyoneFree"))),
    el("div", { class: "g-track" }, backdrop(months), freeWindows().map(w => {
      const label = `${fmtRange(w.start, w.end)} · ${lengthText(w.e - w.s + 1)}`;
      return el("div", { class: "bar free", role: "img", title: label, "aria-label": label, style: { left: pct(w.s), width: pct(w.e - w.s + 1) } }, String(w.e - w.s + 1));
    })));
  document.getElementById("gantt").replaceChildren(header, ...rows, free);
}

function renderFree() {
  const windows = freeWindows();
  const list = document.getElementById("free-list");
  if (!windows.length) return list.replaceChildren(el("li", { class: "muted" }, t("freeNone")));
  list.replaceChildren(...windows.map(w => el("li", {},
    el("strong", {}, fmtRange(w.start, w.end)),
    el("span", { class: "muted" }, lengthText(w.e - w.s + 1)),
    state.admin ? el("button", { type: "button", class: "link-button", onclick: () => openChosen(w.start, w.end) }, t("choose")) : null)));
}

function renderChosen() {
  const banner = document.getElementById("chosen-banner");
  banner.hidden = !state.chosen;
  document.getElementById("edit-chosen").hidden = !state.admin;
  document.getElementById("set-chosen").hidden = !state.admin || !!state.chosen;
  if (!state.chosen) return;
  const { start, end, label } = state.chosen;
  document.getElementById("chosen-text").textContent =
    `${label ? `${label} · ` : ""}${fmtRange(start, end)} (${lengthText(dayNum(end) - dayNum(start) + 1)})`;
}

function proposalCard(p) {
  const liked = p.reactions.includes(state.me);
  const url = /^https?:\/\//i.test(p.url) ? p.url : "";
  const link = (text) => el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text);
  let host = "";
  try { host = url && new URL(url).hostname.replace(/^www\./, ""); } catch {}
  const commentForm = el("form", { class: "comment-form", onsubmit: async event => {
    event.preventDefault();
    const input = event.target.elements.body;
    if (input.value.trim()) await mutate(`proposals/${p.id}/comments`, "POST", { body: input.value });
  } },
    el("textarea", { name: "body", rows: "1", maxlength: "2000", required: true, placeholder: t("comment"), "aria-label": t("comment") }),
    el("button", { type: "submit", class: "secondary" }, t("commentSubmit")));
  return el("article", { class: "card" },
    el("div", { class: "card-head" },
      el("div", {},
        el("h3", {}, url ? link(p.title) : p.title),
        el("p", { class: "meta" }, t("proposedBy", { name: p.party, date: fmt(p.created_at.slice(0, 10)) }))),
      p.party === state.me ? el("button", { type: "button", class: "link-button danger-text", onclick: () => remove(`proposals/${p.id}`) }, t("delete")) : null),
    host ? el("p", { class: "url" }, "🔗 ", link(host)) : null,
    p.cost_hint ? el("p", { class: "cost" }, "≈ ", p.cost_hint) : null,
    p.description ? el("p", { class: "desc" }, p.description) : null,
    el("div", { class: "card-actions" },
      el("button", {
        type: "button",
        class: `like${liked ? " on" : ""}`,
        "aria-pressed": String(liked),
        title: t("like"),
        onclick: () => mutate(`proposals/${p.id}/react`, "POST"),
      }, `👍 ${p.reactions.length}`),
      p.reactions.length ? el("span", { class: "muted" }, t("likedBy", { names: p.reactions.join(", ") })) : null),
    p.comments.length ? el("ul", { class: "comments" }, p.comments.map(c => el("li", {},
      el("div", { class: "comment-head" },
        el("strong", {}, c.party),
        el("span", { class: "meta" }, fmt(c.created_at.slice(0, 10))),
        c.party === state.me ? el("button", { type: "button", class: "link-button danger-text", onclick: () => remove(`comments/${c.id}`) }, t("delete")) : null),
      el("p", {}, c.body)))) : null,
    commentForm);
}

function renderProposals() {
  const list = document.getElementById("proposals");
  if (!state.proposals.length) return list.replaceChildren(el("p", { class: "muted" }, t("propNone")));
  // Most-liked first; the stable sort keeps newest first among ties.
  const sorted = [...state.proposals].sort((a, b) => b.reactions.length - a.reactions.length);
  list.replaceChildren(...sorted.map(proposalCard));
}

function render() {
  if (!state) return;
  document.getElementById("signed-in").textContent = t("signedInAs", { name: state.me });
  renderChosen();
  renderGantt();
  renderFree();
  renderProposals();
}

function openBlock(block, start, end) {
  editing = block?.id ?? null;
  const form = document.getElementById("block-form");
  const f = form.elements;
  document.getElementById("block-dialog-title").textContent = t(block ? "blockEdit" : "blockNew");
  f.start.value = block?.start ?? start ?? localToday();
  f.end.value = block?.end ?? end ?? f.start.value;
  f.kind.value = block?.kind ?? "hard";
  f.note.value = block?.note ?? "";
  f.end.min = localToday();
  f.start.max = f.end.max = isoOf(START + DAYS - 1);
  document.getElementById("block-delete").hidden = !block;
  form.querySelector(".dialog-error").textContent = "";
  document.getElementById("block-dialog").showModal();
}

function openChosen(start, end) {
  const form = document.getElementById("chosen-form");
  const f = form.elements;
  f.start.value = start ?? state.chosen?.start ?? localToday();
  f.end.value = end ?? state.chosen?.end ?? f.start.value;
  f.label.value = state.chosen?.label ?? "";
  document.getElementById("chosen-clear").hidden = !state.chosen;
  form.querySelector(".dialog-error").textContent = "";
  document.getElementById("chosen-dialog").showModal();
}

function downloadIcs() {
  const { start, end, label } = state.chosen;
  const compact = iso => iso.replaceAll("-", "");
  const escape = text => text.replace(/[\\;,]/g, m => `\\${m}`).replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LEMTIQ//Family Reunion//EN", "BEGIN:VEVENT",
    `UID:family-reunion-${compact(start)}@lemtiq.com`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(start)}`, `DTEND;VALUE=DATE:${compact(isoOf(dayNum(end) + 1))}`,
    `SUMMARY:${escape(label || t("defaultEventTitle"))}`, "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  el("a", { href: url, download: "family-reunion.ics" }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyStatic() {
  document.documentElement.lang = lang;
  document.title = t("pageTitle");
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  const select = document.getElementById("min-length");
  select.replaceChildren(...MIN_LENGTHS.map(n => el("option", { value: n, selected: n === view.minLength }, lengthText(n))));
}

function wire() {
  document.getElementById("lang").addEventListener("click", () => {
    lang = lang === "en" ? "de" : "en";
    writePref("family-lang", lang);
    applyStatic();
    render();
  });
  document.getElementById("min-length").addEventListener("change", event => {
    view.minLength = Number(event.target.value);
    writePref("family-min", view.minLength);
    render();
  });
  const countSoft = document.getElementById("count-soft");
  countSoft.checked = view.countSoft;
  countSoft.addEventListener("change", () => {
    view.countSoft = countSoft.checked;
    writePref("family-soft", view.countSoft ? "1" : "0");
    render();
  });
  document.getElementById("add-block").addEventListener("click", () => openBlock(null));
  document.getElementById("set-chosen").addEventListener("click", () => openChosen());
  document.getElementById("edit-chosen").addEventListener("click", () => openChosen());
  document.getElementById("ics").addEventListener("click", downloadIcs);
  for (const button of document.querySelectorAll("dialog [data-close]")) {
    button.addEventListener("click", () => button.closest("dialog").close());
  }

  const blockForm = document.getElementById("block-form");
  blockForm.addEventListener("submit", event => {
    event.preventDefault();
    const f = blockForm.elements;
    const body = { start: f.start.value, end: f.end.value, kind: f.kind.value, note: f.note.value };
    if (body.end < body.start) [body.start, body.end] = [body.end, body.start];
    dialogMutate("block-dialog", editing ? `blocks/${editing}` : "blocks", editing ? "PUT" : "POST", body);
  });
  document.getElementById("block-delete").addEventListener("click", () => {
    if (editing && confirm(t("confirmDelete"))) dialogMutate("block-dialog", `blocks/${editing}`, "DELETE");
  });

  const chosenForm = document.getElementById("chosen-form");
  chosenForm.addEventListener("submit", event => {
    event.preventDefault();
    const f = chosenForm.elements;
    dialogMutate("chosen-dialog", "chosen", "PUT", { start: f.start.value, end: f.end.value, label: f.label.value });
  });
  document.getElementById("chosen-clear").addEventListener("click", () => {
    if (confirm(t("confirmDelete"))) dialogMutate("chosen-dialog", "chosen", "PUT", { clear: true });
  });

  const proposalForm = document.getElementById("proposal-form");
  proposalForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (await mutate("proposals", "POST", Object.fromEntries(new FormData(proposalForm)))) proposalForm.reset();
  });
}

async function init() {
  applyStatic();
  wire();
  setStatus(t("loading"));
  try {
    state = await api("state");
    setStatus("");
    render();
  } catch (error) {
    setStatus(error.message, true);
  }
}

init();
