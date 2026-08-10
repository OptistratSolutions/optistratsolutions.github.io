import {createServer} from "node:http";
import {readFile, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "projects/pandrol-sara-2026/data/project.json");
const original = await readFile(output, "utf8");
const now = Date.now();
const day = 86400000;

const parent = {
  id: "869edm1p7",
  name: "Pandrol SA SARA Exhibition",
  custom_fields: [
    {name: "Approved Budget", value: "100000"},
    {name: "Forecast at Completion", value: "103000"}
  ]
};

const tasks = [
  {id: "a", parent: "869edm1p7", name: "1.3 Hold sponsor kickoff", status: {status: "complete", type: "closed"}, due_date: String(now - 2 * day), date_closed: String(now - 3 * day), time_estimate: 7200000, priority: {priority: "urgent"}, tags: []},
  {id: "b", parent: "869edm1p7", name: "Approve scope decision", status: {status: "in progress", type: "custom"}, due_date: String(now + day), time_estimate: 7200000, priority: {priority: "high"}, tags: [{name: "client-attention"}, {name: "decision-required"}]},
  {id: "c", parent: "869edm1p7", name: "Published logistics risk", status: {status: "open", type: "open"}, due_date: String(now + 5 * day), time_estimate: 3600000, priority: {priority: "high"}, tags: [{name: "client-visible"}, {name: "risk"}]},
  {id: "d", parent: "a", name: "Nested completed task", status: {status: "complete", type: "closed"}, due_date: String(now - day), date_closed: String(now - 2 * day), time_estimate: 3600000, priority: {priority: "normal"}, tags: []},
  {id: "outside", parent: "another-project", name: "Unrelated task", status: {status: "open", type: "open"}, due_date: String(now - day), priority: {priority: "urgent"}, tags: []}
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
      env: {...process.env, CLICKUP_API_TOKEN: "test-token", CLICKUP_API_ROOT: `http://127.0.0.1:${port}/api/v2`},
      stdio: "inherit"
    });
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Sync exited with ${code}`)));
  });
  const result = JSON.parse(await readFile(output, "utf8"));
  if (result.progress.detail !== "2 of 4 tasks verified complete") throw new Error("Project-tree filtering or completion count failed");
  if (result.clientAttention.length !== 1) throw new Error("Client-attention publication rule failed");
  if (result.publishedRisksIssues.length !== 1) throw new Error("Risk publication rule failed");
  if (result.deliveryKpis.find((item) => item.label === "Budget status")?.value !== "+3.0%") throw new Error("Budget KPI failed");
  console.log("Sync transformation test passed.");
} finally {
  server.close();
  await writeFile(output, original, "utf8");
}
