const DATA_URL = "./data/project.json";

const qs = (selector) => document.querySelector(selector);
const formatDate = (value, options = {}) => {
  if (!value) return "Date not set";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: options.withYear === false ? undefined : "numeric",
    timeZone: "Africa/Johannesburg"
  }).format(new Date(value));
};

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const toneClass = (tone) => ["green", "amber", "red", "blue"].includes(tone) ? tone : "neutral";

function setText(selector, value) {
  const element = qs(selector);
  if (element) element.textContent = value ?? "—";
}

function renderExecutive(data) {
  const rag = toneClass(data.health?.rag);
  const overall = qs("#overall-rag");
  overall.className = `rag-pill rag-${rag}`;
  overall.textContent = data.health?.label || "Status unavailable";
  setText("#health-summary", data.health?.summary || "No health narrative is available.");
  setText("#current-phase", data.phase?.name || "Not determined");
  setText("#phase-window", data.phase?.description || "");
  setText("#next-milestone", data.nextMilestone?.name || "No upcoming milestone");
  setText("#next-milestone-date", data.nextMilestone?.date ? formatDate(data.nextMilestone.date) : "Date not set");

  const progress = Number.isFinite(data.progress?.percent) ? Math.max(0, Math.min(100, data.progress.percent)) : null;
  setText("#project-progress", progress === null ? "—" : `${Math.round(progress)}%`);
  setText("#progress-denominator", data.progress?.detail || "Awaiting sync");
  const bar = qs("#project-progress-bar");
  bar.style.width = `${progress ?? 0}%`;
  bar.parentElement.setAttribute("aria-valuenow", String(progress ?? 0));

  const eventDate = new Date(data.project?.eventStart || "2026-10-20T00:00:00+02:00");
  const now = new Date();
  const days = Math.ceil((eventDate - now) / 86400000);
  setText("#event-countdown", days > 1 ? `${days} days` : days === 1 ? "1 day" : days === 0 ? "Today" : "Event complete");
}

function renderAttention(items = []) {
  const panel = qs("#attention-panel");
  const list = qs("#attention-list");
  setText("#attention-count", items.length);
  panel.classList.toggle("is-clear", items.length === 0);
  if (!items.length) {
    list.innerHTML = '<p class="empty-state">No published client-attention items are currently overdue or awaiting a decision.</p>';
    return;
  }
  list.innerHTML = items.map((item) => `
    <article class="attention-item">
      <span class="status-chip status-${toneClass(item.tone)}">${escapeHtml(item.type || "Action")}</span>
      <div><strong>${escapeHtml(item.name)}</strong></div>
      <span class="deadline-date">${escapeHtml(item.dueDate ? formatDate(item.dueDate) : "No due date")}</span>
    </article>`).join("");
}

function renderKpis(items = []) {
  const host = qs("#delivery-kpis");
  host.innerHTML = items.map((item) => `
    <article class="kpi-card">
      <div class="kpi-card-top">
        <span class="kpi-label">${escapeHtml(item.label)}</span>
        <span class="status-chip status-${toneClass(item.tone)}">${escapeHtml(item.status || "Info")}</span>
      </div>
      <div class="kpi-value">${escapeHtml(item.value ?? "—")}</div>
      <p class="kpi-detail">${escapeHtml(item.detail || "")}</p>
    </article>`).join("");
}

function renderMilestones(items = []) {
  const host = qs("#milestone-list");
  if (!items.length) {
    host.innerHTML = '<p class="empty-state">No milestone data is available yet.</p>';
    return;
  }
  host.innerHTML = items.map((item) => {
    const stateClass = item.state === "complete" ? "is-complete" : item.state === "next" ? "is-next" : "";
    return `<article class="milestone-item ${stateClass}">
      <span class="milestone-marker" aria-hidden="true"></span>
      <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.note || item.status || "")}</small></div>
      <span class="deadline-date">${escapeHtml(formatDate(item.date, {withYear: false}))}</span>
    </article>`;
  }).join("");
}

function renderDeadlines(items = []) {
  const host = qs("#deadline-list");
  if (!items.length) {
    host.innerHTML = '<p class="empty-state">No upcoming published deadlines.</p>';
    return;
  }
  host.innerHTML = items.map((item) => `
    <article class="deadline-item">
      <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.status || "")}</small></div>
      <span class="deadline-date">${escapeHtml(formatDate(item.dueDate, {withYear: false}))}</span>
    </article>`).join("");
}

function renderRisks(items = []) {
  const host = qs("#risk-list");
  if (!items.length) {
    host.innerHTML = '<p class="empty-state">No client-visible risk or issue items are currently published.</p>';
    return;
  }
  host.innerHTML = items.map((item) => `
    <article class="risk-item">
      <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.response || item.status || "")}</small></div>
      <span class="status-chip status-${toneClass(item.tone)}">${escapeHtml(item.rating || item.type || "Open")}</span>
    </article>`).join("");
}

function renderReadiness(readiness = {}) {
  const active = Number.isFinite(readiness.percent);
  const percent = active ? Math.max(0, Math.min(100, readiness.percent)) : 0;
  setText("#readiness-value", active ? `${Math.round(percent)}%` : "—");
  setText("#readiness-label", readiness.label || "Not yet active");
  setText("#readiness-note", readiness.note || "Readiness will activate at the relevant project gate.");
  qs("#readiness-ring").style.background = `conic-gradient(var(--cyan-500) ${percent * 3.6}deg, var(--slate-100) 0deg)`;
}

function renderOutcomes(groups = [], note) {
  setText("#outcome-phase-note", note || "These measures activate when the relevant project phase begins.");
  const host = qs("#outcome-groups");
  host.innerHTML = groups.map((group) => `
    <article class="outcome-group ${group.active ? "" : "is-inactive"}">
      <div class="outcome-group-header">
        <h3>${escapeHtml(group.title)}</h3>
        <span class="status-chip status-${group.active ? "blue" : "neutral"}">${group.active ? "Active" : escapeHtml(group.activationLabel || "Future phase")}</span>
      </div>
      <div class="outcome-list">
        ${(group.items || []).map((item) => `<div class="outcome-row"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value ?? "—")}</strong></div>`).join("")}
      </div>
    </article>`).join("");
}

function renderUpdated(value) {
  if (!value) return;
  const formatted = new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg"
  }).format(new Date(value));
  const time = qs("#last-updated");
  time.textContent = `${formatted} SAST`;
  time.dateTime = value;
}

function render(data) {
  renderExecutive(data);
  renderAttention(data.clientAttention);
  renderKpis(data.deliveryKpis);
  renderMilestones(data.milestones);
  renderDeadlines(data.upcomingDeadlines);
  renderRisks(data.publishedRisksIssues);
  renderReadiness(data.readiness);
  renderUpdated(data.generatedAt);
}

async function loadDashboard() {
  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, {cache: "no-store"});
    if (!response.ok) throw new Error(`Dashboard data returned ${response.status}`);
    render(await response.json());
  } catch (error) {
    console.error(error);
    const overall = qs("#overall-rag");
    overall.className = "rag-pill rag-neutral";
    overall.textContent = "Data temporarily unavailable";
    setText("#health-summary", "The reporting layer could not load the latest snapshot. ClickUp remains the project system of record.");
  }
}

loadDashboard();
