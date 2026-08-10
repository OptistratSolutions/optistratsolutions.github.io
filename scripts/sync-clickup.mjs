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
const now = new Date();

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
  const today = now.toISOString().slice(0, 10);
  return config.phaseDates.find((phase) => today >= phase.from && today <= phase.to)
    || (today < config.phaseDates[0].from
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
    const match = tasks.find((task) => normalized(task.name).includes(normalized(item.taskMatch)));
    const date = dateIso(match?.due_date) || item.date;
    const complete = match ? isDone(match) : false;
    const unlinked = !match;
    const overdue = !complete && !unlinked && new Date(date) < now;
    return {
      name: item.name,
      date,
      complete,
      overdue,
      unlinked,
      note: complete ? "Achieved" : overdue ? "Overdue" : match ? match.status?.status || "Planned" : "Planned date"
    };
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
  const nextIndex = milestones.findIndex((item) => !item.complete && (!item.unlinked || new Date(item.date) >= now));
  return milestones.map((item, index) => ({
    ...item,
    state: item.complete ? "complete" : index === nextIndex ? "next" : "upcoming"
  }));
}

function currency(value) {
  return new Intl.NumberFormat("en-ZA", {style: "currency", currency: "ZAR", maximumFractionDigits: 0}).format(value);
}

function metricValue(task, key, suffix = "") {
  const value = findField(task, config.customFieldAliases[key]);
  if (value === null) return "Awaiting data";
  return `${value}${suffix}`;
}

const parentTask = await api(`/task/${config.projectTaskId}`);
const allTasks = await getListTasks(config.listId);
const tasks = selectProjectTree(allTasks, config.projectTaskId);
const milestones = buildMilestones(tasks);
const nextMilestone = milestones.find((item) => !item.complete) || null;
const phase = projectPhase();
const progress = taskProgress(tasks);
const openTasks = tasks.filter((task) => !isDone(task));
const overdue = openTasks.filter((task) => dateMs(task.due_date) && dateMs(task.due_date) < now.getTime());
const overdueCritical = overdue.filter((task) => ["urgent", "high"].includes(normalized(task.priority?.priority || task.priority)));
const attention = openTasks
  .filter((task) => includesAny(tagsOf(task), config.publication.clientAttentionTags))
  .sort((a, b) => (dateMs(a.due_date) || Infinity) - (dateMs(b.due_date) || Infinity))
  .slice(0, 8)
  .map((task) => ({
    name: task.name,
    type: tagsOf(task).includes("approval required") ? "Approval" : tagsOf(task).includes("decision required") ? "Decision" : "Action",
    dueDate: dateIso(task.due_date),
    tone: dateMs(task.due_date) && dateMs(task.due_date) < now.getTime() ? "red" : "amber"
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

const dueTasks = tasks.filter((task) => dateMs(task.due_date) && dateMs(task.due_date) <= now.getTime());
const onTimeDue = dueTasks.filter((task) => isDone(task) && (!dateMs(task.date_done || task.date_closed) || dateMs(task.date_done || task.date_closed) <= dateMs(task.due_date)));
const scheduleAdherence = dueTasks.length ? Math.round((onTimeDue.length / dueTasks.length) * 100) : null;
const dueMilestones = milestones.filter((item) => new Date(item.date) <= now);
const onTimeMilestones = dueMilestones.filter((item) => item.complete);
const milestoneAdherence = dueMilestones.length ? Math.round((onTimeMilestones.length / dueMilestones.length) * 100) : null;

const supplierTasks = tasks.filter((task) => includesAny(tagsOf(task), config.publication.supplierTags));
const supplierDue = supplierTasks.filter((task) => dateMs(task.due_date) && dateMs(task.due_date) <= now.getTime());
const supplierOnTime = supplierDue.filter((task) => isDone(task) && dateMs(task.date_done || task.date_closed) <= dateMs(task.due_date));
const supplierOtif = supplierDue.length ? Math.round((supplierOnTime.length / supplierDue.length) * 100) : null;

const readinessTasks = tasks.filter((task) => includesAny(tagsOf(task), config.publication.readinessTags) || /^3\./.test(task.name || ""));
const readinessDue = readinessTasks.filter((task) => dateMs(task.due_date) && dateMs(task.due_date) <= now.getTime());
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

const twoWeeks = now.getTime() + 14 * 86400000;
const upcomingDeadlines = openTasks
  .filter((task) => dateMs(task.due_date) && dateMs(task.due_date) >= now.getTime() && dateMs(task.due_date) <= twoWeeks)
  .sort((a, b) => dateMs(a.due_date) - dateMs(b.due_date))
  .slice(0, 8)
  .map((task) => ({name: task.name, dueDate: dateIso(task.due_date), status: task.status?.status || "Open"}));

const eventActive = now >= new Date(config.project.eventStart) && now <= new Date(config.project.eventEnd);
const postEventActive = now > new Date(config.project.eventEnd);
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
  },
  outcomePhaseNote: eventActive ? "Event measures are live and update from approved ClickUp fields." : postEventActive ? "Post-event conversion measures are active." : "Exhibition and post-event measures are intentionally dormant during delivery.",
  outcomeGroups: [
    {
      title: "Exhibition outcomes",
      active: eventActive || postEventActive,
      activationLabel: "Opens at event",
      items: [
        {label: "Qualified leads", value: eventActive || postEventActive ? metricValue(parentTask, "qualifiedLeads") : "Not active"},
        {label: "Priority-account meetings", value: eventActive || postEventActive ? metricValue(parentTask, "priorityMeetings") : "Not active"},
        {label: "Demonstrations", value: eventActive || postEventActive ? metricValue(parentTask, "demonstrations") : "Not active"},
        {label: "Meaningful conversations", value: eventActive || postEventActive ? metricValue(parentTask, "meaningfulConversations") : "Not active"},
        {label: "Lead-data completeness", value: eventActive || postEventActive ? metricValue(parentTask, "leadCompleteness", "%") : "Not active"},
        {label: "Stakeholder satisfaction", value: eventActive || postEventActive ? metricValue(parentTask, "stakeholderSatisfaction") : "Not active"}
      ]
    },
    {
      title: "Post-event conversion",
      active: postEventActive,
      activationLabel: "Opens after event",
      items: [
        {label: "Lead handover time", value: postEventActive ? metricValue(parentTask, "leadHandoverHours", " h") : "Not active"},
        {label: "Follow-up within SLA", value: postEventActive ? metricValue(parentTask, "followUpSla", "%") : "Not active"},
        {label: "Opportunities created", value: postEventActive ? metricValue(parentTask, "opportunitiesCreated") : "Not active"},
        {label: "Management report turnaround", value: postEventActive ? metricValue(parentTask, "reportTurnaroundDays", " days") : "Not active"}
      ]
    }
  ]
};

const outputPath = resolve(ROOT, config.publicPath, "data/project.json");
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Updated ${config.slug}: ${tasks.length} project tasks, ${overdueCritical.length} overdue critical actions.`);
