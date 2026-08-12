import {createServer} from "node:http";
import {readFile, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "projects/pandrol-sara-2026/data/project.json");
const original = await readFile(output, "utf8");
const syncNow = "2026-08-12T12:00:00+02:00";
const ms = (value) => String(new Date(value).getTime());

const parent = {
  id: "869edm1p7",
  name: "Pandrol SA SARA Exhibition",
  custom_fields: [
    {name: "Approved Budget", value: "100000"},
    {name: "Forecast at Completion", value: "103000"}
  ]
};

const tasks = [
  {id: "869edm838", parent: "869edm1p7", name: "Renamed mobilisation milestone", status: {status: "complete", type: "closed"}, due_date: ms("2026-08-11T04:00:00+02:00"), date_closed: ms("2026-08-11T15:00:00+02:00"), time_estimate: 7200000, priority: {priority: "urgent"}, tags: []},
  {id: "b", parent: "869edm1p7", name: "Approve scope decision", status: {status: "in progress", type: "custom"}, due_date: ms("2026-08-13T04:00:00+02:00"), time_estimate: 7200000, priority: {priority: "high"}, tags: [{name: "client-attention"}, {name: "decision-required"}]},
  {id: "c", parent: "869edm1p7", name: "Published logistics risk", status: {status: "open", type: "open"}, due_date: ms("2026-08-17T04:00:00+02:00"), time_estimate: 3600000, priority: {priority: "normal"}, tags: [{name: "client-visible"}, {name: "risk"}]},
  {id: "d", parent: "869edm838", name: "Nested completed task", status: {status: "complete", type: "closed"}, due_date: ms("2026-08-11T04:00:00+02:00"), date_closed: ms("2026-08-11T18:00:00+02:00"), time_estimate: 3600000, priority: {priority: "normal"}, tags: []},
  {id: "e", parent: "869edm838", name: "Due today at ClickUp's early timestamp", status: {status: "planning", type: "open"}, due_date: ms("2026-08-12T04:00:00+02:00"), time_estimate: 3600000, priority: {priority: "high"}, tags: [{name: "client-attention"}]},
  {id: "f", parent: "869edm1p7", name: "3.1.3 – Organiser information, not readiness", status: {status: "complete", type: "closed"}, due_date: ms("2026-08-11T04:00:00+02:00"), date_closed: ms("2026-08-11T16:00:00+02:00"), time_estimate: 3600000, priority: {priority: "normal"}, tags: []},
  {id: "g", parent: "869edm1p7", name: "Future readiness gate", status: {status: "planning", type: "open"}, due_date: ms("2026-09-18T17:00:00+02:00"), time_estimate: 3600000, priority: {priority: "urgent"}, tags: [{name: "readiness"}]},
  {id: "outside", parent: "another-project", name: "Unrelated task", status: {status: "open", type: "open"}, due_date: ms("2026-08-10T04:00:00+02:00"), priority: {priority: "urgent"}, tags: []}
];

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/v2/task/869edm1p7") return response.end(JSON.stringify(parent));
  if (request.url?.startsWith("/api/v2/list/901218737577/task")) return response.end(JSON.stringify({tasks, last_page: true}));
  response.statusCode = 404;
  response.end(JSON.stringify({error: "not found"}));
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const {port} = server.address();

try {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(root, "scripts/sync-clickup.mjs")], {
      cwd: root,
      env: {...process.env, CLICKUP_API_TOKEN: "test-token", CLICKUP_API_ROOT: `http://127.0.0.1:${port}/api/v2`, SYNC_NOW: syncNow},
      stdio: "inherit"
    });
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Sync exited with ${code}`)));
  });
  const result = JSON.parse(await readFile(output, "utf8"));
  if (result.progress.detail !== "3 of 7 tasks verified complete") throw new Error("Project-tree filtering or completion count failed");
  if (result.clientAttention.length !== 2) throw new Error("Client-attention publication rule failed");
  if (result.clientAttention.find((item) => item.name.startsWith("Due today"))?.tone !== "amber") throw new Error("A task due today must not be overdue before the day ends");
  if (result.publishedRisksIssues.length !== 1) throw new Error("Risk publication rule failed");
  if (!result.upcomingDeadlines.some((item) => item.name.startsWith("Due today"))) throw new Error("Today's open deadlines must appear in the look-ahead");
  if (result.deliveryKpis.find((item) => item.label === "Overdue critical actions")?.value !== "0") throw new Error("Today's high-priority task was incorrectly marked overdue");
  if (result.deliveryKpis.find((item) => item.label === "Schedule health")?.value !== "100%") throw new Error("Same-day completion must count as on time");
  if (result.deliveryKpis.find((item) => item.label === "Readiness pass rate")?.value !== "Not active") throw new Error("Untagged Phase 3 organiser work must not affect readiness");
  if (result.milestones.find((item) => item.name === "Formal mobilisation")?.state !== "complete") throw new Error("Milestone task-ID matching failed");
  if ("outcomeGroups" in result || "outcomePhaseNote" in result) throw new Error("Removed outcome data must not be published");
  if (result.deliveryKpis.find((item) => item.label === "Budget status")?.value !== "+3.0%") throw new Error("Budget KPI failed");
  console.log("Sync transformation test passed.");
} finally {
  server.close();
  await writeFile(output, original, "utf8");
}
