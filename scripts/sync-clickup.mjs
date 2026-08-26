import {readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = process.env.PROJECT_CONFIG || resolve(ROOT, "config/projects/pandrol-sara-2026.json");
const API_ROOT = process.env.CLICKUP_API_ROOT || "https://api.clickup.com/api/v2";
const token = process.env.CLICKUP_API_TOKEN;

if (!token) {
  console.error("CLICKUP_API_TOKEN is required.");
  process.exit(1);
}

const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
const normalized = (value = "") => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tagsOf = (task) => (task.tags || []).map((tag) => normalized(tag.name || tag));
const parentId = (task) => typeof task.parent === "object" ? String(task.parent?.id || "") : String(task.parent || "");
const statusName = (task) => normalized(task.status?.status || task.status || "");
const isDone = (task) => ["done", "closed", "complete", "completed"].includes(normalized(task.status?.type)) || ["done", "closed", "complete", "completed"].includes(statusName(task));
const dateIso = (value) => value ? new Date(Number.isFinite(Number(value)) ? Number(value) : value).toISOString() : null;
const dateMs = (value) => value ? new Date(Number.isFinite(Number(value)) ? Number(value) : value).getTime() : null;
const now = new Date(process.env.SYNC_NOW || Date.now());
const projectUtcOffsetMinutes = Number(config.project.utcOffsetMinutes ?? 120);
const projectOffsetMs = projectUtcOffsetMinutes * 60 * 1000;

function projectDateKey(value) {
  const milliseconds = value instanceof Date ? value.getTime() : dateMs(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds + projectOffsetMs).toISOString().slice(0, 10);
}

function projectDayNumber(value) {
  const key = projectDateKey(value);
  return key ? Math.floor(Date.parse(`${key}T00:00:00Z`) / 86400000) : null;
}

const todayKey = projectDateKey(now);
const todayDay = projectDayNumber(now);
const isPastProjectDay = (value) => {
  const key = projectDateKey(value);
  return key !== null && key < todayKey;
};
const completedOnOrBeforeDueDay = (task) => {
  if (!isDone(task)) return false;
  const completed = task.date_done || task.date_closed;
  return !completed || projectDateKey(completed) <= projectDateKey(task.due_date);
};

async function api(path) {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {Authorization: token, "Content-Type": "application/json"}
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`ClickUp request failed (${response.status}): ${message.slice(0, 300)}`);
  }
  return response.json();
}

async function getListTasks(listId) {
  const tasks = [];
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({include_closed: "true", subtasks: "true", archived: "false", page: String(page)});
    const payload = await api(`/list/${listId}/task?${query}`);
    const batch = payload.tasks || [];
    tasks.push(...batch);
    if (batch.length < 100 || payload.last_page === true) break;
  }
  return tasks;
}

function selectProjectTree(tasks, projectTaskId) {
  const selected = new Set([String(projectTaskId)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (!selected.has(String(task.id)) && selected.has(parentId(task))) {
        selected.add(String(task.id));
        changed = true;
      }
    }
  }
  return tasks.filter((task) => selected.has(String(task.id)) && String(task.id) !== String(projectTaskId));
}

function fieldDisplay(field) {
  const value = field?.value;
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return value.name || value.label || value.value || null;
  const options = field.type_config?.options || [];
  const option = options.find((entry) => String(entry.id) === String(value) || String(entry.orderindex) === String(value));
  return option?.name ?? value;
}

function findField(task, aliases = []) {
  const names = aliases.map(normalized);
  const field = (task.custom_fields || []).find((candidate) => names.includes(normalized(candidate.name)));
  return field ? fieldDisplay(field) : null;
}

function numberValue(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function includesAny(values, targets) {
  const targetSet = (targets || []).map(normalized);
  return values.some((value) => targetSet.includes(normalized(value)));
}

function toneForPercent(value, green = 90, amber = 75) {
  if (value === null) return "neutral";
  if (value >= green) return "green";
  if (value >= amber) return "amber";
  return "red";
}

function projectPhase() {
  return config.phaseDates.find((phase) => todayKey >= phase.from && todayKey <= phase.to)
    || (todayKey < config.phaseDates[0].from
      ? {name: "Pre-start readiness", description: "Pre-mobilisation preparation"}
      : {name: "Closed", description: "Project delivery period complete"});
}

function taskProgress(tasks) {
  const eligible = tasks.filter((task) => !task.archived);
  const weighted = eligible.map((task) => ({task, weight: Math.max(1, Number(task.time_estimate || 0))}));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  const complete = weighted.filter(({task}) => isDone(task)).reduce((sum, item) => sum + item.weight, 0);
  return {
    percent: total ? Math.round((complete / total) * 1000) / 10 : 0,
    detail: `${weighted.filter(({task}) => isDone(task)).length} of ${eligible.length} tasks verified complete`
  };
}

function buildMilestones(tasks) {
  const milestones = config.milestones.map((item) => {
    const aliases = Array.isArray(item.taskMatch) ? item.taskMatch : [item.taskMatch].filter(Boolean);
    const match = tasks.find((task) => String(task.id) === String(item.taskId))
      || tasks.find((task) => aliases.some((alias) => normalized(task.name).includes(normalized(alias))));
    const date = dateIso(match?.due_date) || item.date;
    const complete = match ? isDone(match) : false;
    const unlinked = !match;
    const overdue = !complete && !unlinked && isPastProjectDay(date);
    return {
      name: item.name,
      date,
      complete,
      overdue,
      unlinked,
      note: complete ? "Achieved" : overdue ? "Overdue" : match ? match.status?.status || "Planned" : "Planned date"
    };
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
  const nextIndex = milestones.findIndex((item) => !item.complete && (!item.unlinked || !isPastProjectDay(item.date)));
  return milestones.map((item, index) => ({
    ...item,
    state: item.complete ? "complete" : index === nextIndex ? "next" : "upcoming"
  }));
}

function currency(value) {
  return new Intl.NumberFormat("en-ZA", {style: "currency", currency: "ZAR", maximumFractionDigits: 0}).format(value);
}

const allTasks = await getListTasks(config.listId);
const configuredProjectTask = allTasks.find((task) => String(task.id) === String(config.projectTaskId));
if (!configuredProjectTask) {
  throw new Error(
    `Pandrol dashboard sync aborted: configured project task ${config.projectTaskId} was not found in ClickUp List ${config.listId}. ` +
    "The ClickUp project/List configuration may have changed. Existing dashboard snapshot was preserved."
  );
}

const tasks = selectProjectTree(allTasks, config.projectTaskId);
if (tasks.length === 0) {
  throw new Error(
    `Pandrol dashboard sync aborted: project task ${config.projectTaskId} unexpectedly returned zero child tasks from ClickUp List ${config.listId}. ` +
    "The ClickUp project/List configuration may have changed. Existing dashboard snapshot was preserved."
  );
}

const parentTask = await api(`/task/${config.projectTaskId}`);
const milestones = buildMilestones(tasks);
const nextMilestone = milestones.find((item) => !item.complete) || null;
const phase = projectPhase();
const progress = taskProgress(tasks);
const openTasks = tasks.filter((task) => !isDone(task));
const overdue = openTasks.filter((task) => isPastProjectDay(task.due_date));
const overdueCritical = overdue.filter((task) => ["urgent", "high"].includes(normalized(task.priority?.priority || task.priority)));
const attention = openTasks
  .filter((task) => includesAny(tagsOf(task), config.publication.clientAttentionTags))
  .sort((a, b) => (dateMs(a.due_date) || Infinity) - (dateMs(b.due_date) || Infinity))
  .slice(0, 8)
  .map((task) => ({
    name: task.name,
    type: tagsOf(task).includes("approval required") ? "Approval" : tagsOf(task).includes("decision required") ? "Decision" : "Action",
    dueDate: dateIso(task.due_date),
    tone: isPastProjectDay(task.due_date) ? "red" : "amber"
  }));

const publishedRisksIssues = openTasks
  .filter((task) => includesAny(tagsOf(task), config.publication.clientVisibleTags) && includesAny(tagsOf(task), config.publication.riskTags))
  .slice(0, 6)
  .map((task) => ({
    name: task.name,
    type: tagsOf(task).includes("issue") ? "Issue" : "Risk",
    rating: task.priority?.priority || "Open",
    status: task.status?.status || "Open",
    response: task.status?.status || "Open",
    tone: ["urgent", "high"].includes(normalized(task.priority?.priority)) ? "red" : "amber"
  }));

const dueTasks = tasks.filter((task) => isPastProjectDay(task.due_date));
const onTimeDue = dueTasks.filter(completedOnOrBeforeDueDay);
const scheduleAdherence = dueTasks.length ? Math.round((onTimeDue.length / dueTasks.length) * 100) : null;
const dueMilestones = milestones.filter((item) => isPastProjectDay(item.date));
const onTimeMilestones = dueMilestones.filter((item) => item.complete);
const milestoneAdherence = dueMilestones.length ? Math.round((onTimeMilestones.length / dueMilestones.length) * 100) : null;

const supplierTasks = tasks.filter((task) => includesAny(tagsOf(task), config.publication.supplierTags));
const supplierDue = supplierTasks.filter((task) => isPastProjectDay(task.due_date));
const supplierOnTime = supplierDue.filter(completedOnOrBeforeDueDay);
const supplierOtif = supplierDue.length ? Math.round((supplierOnTime.length / supplierDue.length) * 100) : null;

const readinessTasks = tasks.filter((task) => includesAny(tagsOf(task), config.publication.readinessTags));
const readinessDue = readinessTasks.filter((task) => isPastProjectDay(task.due_date));
const readinessCalculated = readinessDue.length ? Math.round((readinessDue.filter(isDone).length / readinessDue.length) * 100) : null;
const readinessCustom = numberValue(findField(parentTask, config.customFieldAliases.readinessPercent));
const readinessPercent = readinessCustom ?? readinessCalculated;

const changeTasks = tasks.filter((task) => includesAny(tagsOf(task), config.publication.changeTags));
const approvedBudget = numberValue(findField(parentTask, config.customFieldAliases.budgetApproved));
const forecastBudget = numberValue(findField(parentTask, config.customFieldAliases.budgetForecast));
const budgetVariance = approvedBudget && forecastBudget !== null ? ((forecastBudget - approvedBudget) / approvedBudget) * 100 : null;
const budgetTone = budgetVariance === null ? "neutral" : Math.abs(budgetVariance) <= 5 ? "green" : Math.abs(budgetVariance) <= 10 ? "amber" : "red";
const budgetValue = budgetVariance === null ? "Awaiting baseline" : `${budgetVariance >= 0 ? "+" : ""}${budgetVariance.toFixed(1)}%`;
const budgetDetail = approvedBudget ? `${currency(forecastBudget)} forecast vs ${currency(approvedBudget)} approved` : "Approved budget and forecast not yet published";

let rag = "green";
let healthLabel = "On track";
let healthSummary = "No critical schedule exception is currently visible in the published project data.";
if (overdueCritical.length || nextMilestone?.overdue) {
  rag = "red";
  healthLabel = "Intervention required";
  healthSummary = `${overdueCritical.length} overdue high-priority action${overdueCritical.length === 1 ? "" : "s"} require recovery or an approved rebaseline.`;
} else if (overdue.length || publishedRisksIssues.some((item) => item.tone === "red")) {
  rag = "amber";
  healthLabel = "Attention required";
  healthSummary = `${overdue.length} overdue action${overdue.length === 1 ? "" : "s"} are being controlled; client decisions are shown below where applicable.`;
}

const upcomingDeadlines = openTasks
  .filter((task) => {
    const dueDay = projectDayNumber(task.due_date);
    return dueDay !== null && dueDay >= todayDay && dueDay <= todayDay + 14;
  })
  .sort((a, b) => dateMs(a.due_date) - dateMs(b.due_date))
  .slice(0, 8)
  .map((task) => ({name: task.name, dueDate: dateIso(task.due_date), status: task.status?.status || "Open"}));

const snapshot = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  project: {id: config.projectTaskId, ...config.project},
  health: {rag, label: healthLabel, summary: healthSummary},
  phase,
  nextMilestone,
  progress,
  clientAttention: attention,
  deliveryKpis: [
    {label: "Milestone adherence", value: milestoneAdherence === null ? "Not yet due" : `${milestoneAdherence}%`, status: milestoneAdherence === null ? "Future gate" : milestoneAdherence >= 100 ? "On target" : "Below target", tone: milestoneAdherence === null ? "neutral" : toneForPercent(milestoneAdherence, 100, 90), detail: `${onTimeMilestones.length} of ${dueMilestones.length} due critical gates achieved`},
    {label: "Budget status", value: budgetValue, status: budgetVariance === null ? "Not baselined" : budgetTone === "green" ? "Within tolerance" : "Variance", tone: budgetTone, detail: budgetDetail},
    {label: "Overdue critical actions", value: String(overdueCritical.length), status: overdueCritical.length ? "Action" : "Clear", tone: overdueCritical.length ? "red" : "green", detail: "High or urgent incomplete actions past due"},
    {label: "Risk exposure", value: publishedRisksIssues.length ? `${publishedRisksIssues.length} published` : "No published highs", status: publishedRisksIssues.some((item) => item.tone === "red") ? "Elevated" : "Controlled", tone: publishedRisksIssues.some((item) => item.tone === "red") ? "red" : publishedRisksIssues.length ? "amber" : "green", detail: "Only explicitly client-visible risks and issues"},
    {label: "Supplier OTIF", value: supplierOtif === null ? "Not active" : `${supplierOtif}%`, status: supplierOtif === null ? "Future phase" : supplierOtif >= 95 ? "On target" : "Below target", tone: supplierOtif === null ? "neutral" : toneForPercent(supplierOtif, 95, 85), detail: supplierDue.length ? `${supplierOnTime.length} of ${supplierDue.length} due deliveries on time` : "Activates when supplier deliveries fall due"},
    {label: "Readiness pass rate", value: readinessPercent === null ? "Not active" : `${readinessPercent}%`, status: readinessPercent === null ? "Future gate" : readinessPercent >= 90 ? "On target" : "Building", tone: readinessPercent === null ? "neutral" : toneForPercent(readinessPercent, 90, 60), detail: "Accepted checks at active readiness gates"},
    {label: "Change volume", value: String(changeTasks.length), status: changeTasks.filter((task) => !isDone(task)).length ? "Open changes" : "Controlled", tone: changeTasks.filter((task) => !isDone(task)).length ? "amber" : "green", detail: `${changeTasks.filter((task) => !isDone(task)).length} open change request${changeTasks.filter((task) => !isDone(task)).length === 1 ? "" : "s"}`},
    {label: "Schedule health", value: scheduleAdherence === null ? "Not yet due" : `${scheduleAdherence}%`, status: scheduleAdherence === null ? "Future work" : scheduleAdherence >= 90 ? "On target" : "Recovery", tone: scheduleAdherence === null ? "neutral" : toneForPercent(scheduleAdherence, 90, 75), detail: `${onTimeDue.length} of ${dueTasks.length} due tasks completed on time`}
  ],
  milestones,
  upcomingDeadlines,
  publishedRisksIssues,
  readiness: readinessPercent === null ? {
    percent: null,
    label: "Not yet active",
    note: "Formal readiness measurement activates when readiness checks and gates become due."
  } : {
    percent: readinessPercent,
    label: readinessPercent >= 90 ? "Ready for current gate" : readinessPercent >= 60 ? "Building to gate" : "Recovery required",
    note: `${readinessDue.filter(isDone).length} of ${readinessDue.length} due readiness checks passed.`
  }
};

const outputPath = resolve(ROOT, config.publicPath, "data/project.json");
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Updated ${config.slug}: ${tasks.length} project tasks, ${overdueCritical.length} overdue critical actions.`);
