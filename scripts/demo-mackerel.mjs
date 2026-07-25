#!/usr/bin/env node
import { QDashClient } from "@oqtopus-team/qdash-client";

const profile = process.env.QDASH_DEMO_PROFILE || "mackerel";
const chipId = process.env.QDASH_DEMO_CHIP || "144Qv1";
const couplingId = process.env.QDASH_DEMO_COUPLING || "48-50";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};
const color = (code, text) => `${code}${text}${c.reset}`;
const ok = (text) => color(c.green, text);
const warn = (text) => color(c.yellow, text);
const bad = (text) => color(c.red, text);
const key = (text) => color(c.cyan, text);
const val = (text) => color(c.bold, text);

function num(value, digits = 4) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "") : "n/a";
}
function param(task, name) {
  return task?.output_parameters?.[name]?.value ?? task?.input_parameters?.[name]?.value;
}
function error(task, name) {
  return task?.output_parameters?.[name]?.error;
}
function runParam(task, name) {
  return task?.run_parameters?.[name]?.value;
}
function line(left, right = "") {
  console.log(`${left}${right ? ` ${color(c.dim, "·")} ${right}` : ""}`);
}
function status(task) {
  if (!task) return color(c.dim, "missing");
  return task.status === "completed" ? ok("completed") : bad(task.status ?? "unknown");
}
function taskId(task) {
  return task?.task_id ? color(c.dim, task.task_id.slice(0, 8)) : color(c.dim, "--------");
}
async function printSlow(lines, delay = 80) {
  for (const item of lines) {
    console.log(item);
    await sleep(delay);
  }
}
function numericArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "number" && Number.isFinite(item)) : [];
}
function numericMatrix(value) {
  return Array.isArray(value) ? value.map(numericArray).filter((row) => row.length) : [];
}
async function jsonFigure(client, taskId, index = 0) {
  const file = await client.getTaskResultFigure(taskId, { index, preferJson: true });
  return JSON.parse(Buffer.from(file.data).toString("utf8"));
}
function analyzeBell(figure) {
  const heatmap = figure.data?.find((trace) => Array.isArray(trace.z));
  const z = numericMatrix(heatmap?.z);
  const diag = [0, 1, 2, 3].map((i) => z[i]?.[i]);
  const coherence = z[0]?.[3];
  const leakage = Math.max(diag[1] ?? 0, diag[2] ?? 0);
  return { diag, coherence, leakage };
}
function analyzeScatter(figure) {
  const trace = figure.data?.find((item) => Array.isArray(item.y));
  const y = numericArray(trace?.y);
  const tail = y.slice(Math.floor(y.length / 2));
  const span = tail.length ? Math.max(...tail) - Math.min(...tail) : undefined;
  return { first: y[0], second: y[1], last: y[y.length - 1], tailSpan: span };
}

console.clear();
await printSlow([
  color(c.bold, "pi-qdash demo"),
  `${key("profile")} ${val(profile)}   ${key("chip")} ${val(chipId)}   ${key("coupling")} ${val(couplingId)}`,
  color(c.dim, "read-only live query against QDash; no calibration task is executed"),
  "",
], 120);

const client = await QDashClient.fromProfile(profile);
line(`${key("connecting")} QDash profile`, ok("ready"));
await sleep(250);

const resultsPayload = await client.listTaskResults({ chipId, couplingId, limit: 30 });
const results = resultsPayload.items ?? resultsPayload.results ?? resultsPayload.data ?? [];
const byName = (name) => results.find((task) => task.task_name === name || task.name === name);
const crSummary = byName("CheckCrossResonance");
const zxSummary = byName("CheckZX90");
const bellSummary = byName("CheckBellStateTomography");
const coherenceSummary = byName("Check2QGateCoherenceLimit");
const irbSummary = byName("ZX90InterleavedRandomizedBenchmarking");

await printSlow([
  "",
  color(c.bold, "Recent 2Q calibration chain"),
  `  ${taskId(crSummary)}  CheckCrossResonance                  ${status(crSummary)}`,
  `  ${taskId(zxSummary)}  CheckZX90                             ${status(zxSummary)}`,
  `  ${taskId(bellSummary)}  CheckBellStateTomography              ${status(bellSummary)}`,
  `  ${taskId(coherenceSummary)}  Check2QGateCoherenceLimit            ${status(coherenceSummary)}`,
  `  ${taskId(irbSummary)}  ZX90InterleavedRandomizedBenchmarking ${status(irbSummary)}`,
], 120);

const [cr, zx, bell, coherence, irb] = await Promise.all([
  crSummary ? client.getTaskResult(crSummary.task_id) : undefined,
  zxSummary ? client.getTaskResult(zxSummary.task_id) : undefined,
  bellSummary ? client.getTaskResult(bellSummary.task_id) : undefined,
  coherenceSummary ? client.getTaskResult(coherenceSummary.task_id) : undefined,
  irbSummary ? client.getTaskResult(irbSummary.task_id) : undefined,
]);

await sleep(300);
await printSlow([
  "",
  color(c.bold, "Quality signals"),
  `  ${key("zx_rotation_rate")} ${val(num(param(cr, "zx_rotation_rate"), 6))}    ${key("cr_amp")} ${val(num(param(cr, "cr_amplitude"), 3))}`,
  `  ${key("coherence_limit")} ${val(num(param(coherence, "two_qubit_gate_coherence_limit"), 3))}`,
  `  ${key("bell_fidelity")}   ${val(num(param(bell, "bell_state_fidelity"), 3))}`,
  `  ${key("zx90_irb")}        ${val(num(param(irb, "zx90_gate_fidelity"), 3))} ± ${val(num(error(irb, "zx90_gate_fidelity"), 3))}  ${color(c.dim, `n_trials=${runParam(irb, "n_trials") ?? "n/a"}`)}`,
], 130);

await sleep(300);
let bellAnalysis;
let zxA;
let zxB;
try {
  bellAnalysis = analyzeBell(await jsonFigure(client, bell.task_id, 0));
  zxA = analyzeScatter(await jsonFigure(client, zx.task_id, 0));
  zxB = analyzeScatter(await jsonFigure(client, zx.task_id, 1));
} catch (error) {
  console.log(warn(`figure analysis skipped: ${error.message}`));
}

if (bellAnalysis && zxA && zxB) {
  await printSlow([
    "",
    color(c.bold, "Figure-derived evidence"),
    `  ${key("Bell diag")}: [${bellAnalysis.diag.map((x) => num(x, 3)).join(", ")}]  ${key("|00><11|")} ${num(bellAnalysis.coherence, 3)}`,
    `  ${key("CheckZX90 Q048")}: first=${num(zxA.first, 3)} second=${num(zxA.second, 3)} last=${num(zxA.last, 3)} tail-span=${num(zxA.tailSpan, 3)}`,
    `  ${key("CheckZX90 Q050")}: first=${num(zxB.first, 3)} second=${num(zxB.second, 3)} last=${num(zxB.last, 3)} tail-span=${num(zxB.tailSpan, 3)}`,
  ], 120);
}

const issues = [];
const bellF = param(bell, "bell_state_fidelity");
const limit = param(coherence, "two_qubit_gate_coherence_limit");
const irbF = param(irb, "zx90_gate_fidelity");
const irbErr = error(irb, "zx90_gate_fidelity");
if (typeof bellF === "number" && bellF < 0.8) issues.push(`Bell fidelity is low (${num(bellF, 3)})`);
if (typeof limit === "number" && typeof bellF === "number" && limit - bellF > 0.15) issues.push(`coherence limit gap is large (${num(limit - bellF, 3)})`);
if (typeof irbErr === "number" && irbErr > 0.05) issues.push(`IRB uncertainty is large (±${num(irbErr, 3)})`);
if (bellAnalysis?.leakage > 0.15) issues.push(`Bell tomography has high non-ideal population (${num(bellAnalysis.leakage, 3)})`);
if ((zxA?.tailSpan ?? 0) > 0.3 || (zxB?.tailSpan ?? 0) > 0.3) issues.push("CheckZX90 repeated-pulse response is unstable");

await sleep(300);
console.log("");
console.log(color(c.bold, "Diagnosis"));
for (const item of issues) console.log(`  ${warn("!")} ${item}`);
console.log(`  ${bad("decision")}: completed, but not quality-passed`);
console.log(`  ${key("next")}: walk back through CR → CreateZX90 → CheckZX90, then validate Bell tomography before trusting IRB`);
console.log("");
console.log(color(c.dim, "This is the kind of evidence bundle/diagnosis we want pi-qdash skills to automate."));
