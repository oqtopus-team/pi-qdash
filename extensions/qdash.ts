import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { QDashClient, defaultConfigPath, type DownloadedFile, type TaskResultFigureOptions } from "@oqtopus-team/qdash-client";
import { Image, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type QDashQueryParams = {
  profile?: string;
  configPath?: string;
  useEnv?: boolean;
  action:
    | "chips"
    | "default_chip"
    | "metrics_config"
    | "chip_metrics"
    | "chip_qubits"
    | "chip_qubit"
    | "chip_couplings"
    | "chip_coupling"
    | "cryostats"
    | "cryostat"
    | "cooldowns"
    | "cooldown"
    | "cooldown_wiring_events"
    | "timeseries"
    | "task_results"
    | "task_result"
    | "task_note"
    | "task_result_issues"
    | "qubit_latest"
    | "qubit_history"
    | "coupling_latest"
    | "coupling_history"
    | "tasks"
    | "task_knowledge"
    | "task_knowledge_markdown"
    | "projects"
    | "project"
    | "files_tree"
    | "file_content"
    | "git_status"
    | "issues"
    | "issue_knowledge"
    | "flows"
    | "flow"
    | "flow_templates"
    | "flow_template"
    | "flow_helper_files"
    | "flow_helper_file"
    | "executions"
    | "execution"
    | "ai_reviews"
    | "ai_review_runs"
    | "ai_review_run"
    | "forum_posts"
    | "provenance_stats"
    | "provenance_history"
    | "provenance_changes"
    | "provenance_lineage"
    | "provenance_impact";
  chipId?: string;
  qid?: string;
  couplingId?: string;
  cryoId?: string;
  cooldownId?: string;
  taskId?: string;
  taskName?: string;
  task?: string;
  projectId?: string;
  path?: string;
  flowName?: string;
  templateId?: string;
  filename?: string;
  executionId?: string;
  reviewRunId?: string;
  entityId?: string;
  parameter?: string;
  parameterName?: string;
  tag?: string;
  date?: string;
  backend?: string;
  status?: string;
  decision?: string;
  username?: string;
  messageContains?: string;
  startAt?: string;
  endAt?: string;
  startFrom?: string;
  startTo?: string;
  isClosed?: boolean;
  latestOnly?: boolean;
  withinHours?: number;
  limit?: number;
  skip?: number;
  offset?: number;
};

type RawGetParams = {
  profile?: string;
  configPath?: string;
  useEnv?: boolean;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
};

type ConfirmableParams = {
  confirmWrite?: boolean;
};

type FigureDetails = {
  tool: string;
  path: string;
  mediaType: string;
  sizeBytes: number;
  base64?: string;
  text?: string;
  taskId?: string;
  figurePaths?: string[];
  jsonFigurePaths?: string[];
};

type QDashContextState = {
  profile?: string;
  chipId?: string;
  agentSessionId?: string;
  qid?: string;
  couplingId?: string;
  taskName?: string;
  lastExecutionId?: string;
  lastTaskId?: string;
};

const CONTEXT_ENTRY_TYPE = "qdash-context";
const GLOBAL_CONTEXT_PATH = join(homedir(), ".pi", "agent", "qdash-context.json");
const WRITE_TOOL_NAMES = new Set([
  "qdash_create_agent_session",
  "qdash_submit_agent_action",
  "qdash_commit_agent_candidate",
  "qdash_execute_agent_action",
  "qdash_commit_agent_campaign_candidates",
  "qdash_apply_agent_candidate_commit",
  "qdash_create_forum_post",
  "qdash_update_forum_post",
  "qdash_create_forum_evidence_reply",
]);
let currentContext: QDashContextState = {};

function applyQDashContext<T extends { profile?: string; chipId?: string; sessionId?: string }>(params: T): T {
  return {
    ...params,
    profile: params.profile ?? currentContext.profile,
    chipId: params.chipId ?? currentContext.chipId,
    sessionId: params.sessionId ?? currentContext.agentSessionId,
  };
}

function contextSummary(): string {
  const profile = currentContext.profile ?? "env/default";
  const chip = currentContext.chipId ?? "auto-chip";
  const session = currentContext.agentSessionId ? ` session:${shortId(currentContext.agentSessionId)}` : "";
  const target = currentContext.qid ? ` q${currentContext.qid}` : currentContext.couplingId ? ` c${currentContext.couplingId}` : "";
  return `qdash ${profile} ${chip}${target}${session}`;
}

function contextStatusLine(theme?: Theme): string {
  const accent = (value: string) => theme ? theme.fg("accent", value) : value;
  const dim = (value: string) => theme ? theme.fg("dim", value) : value;
  const success = (value: string) => theme ? theme.fg("success", value) : value;
  const warn = (value: string) => theme ? theme.fg("warning", value) : value;
  const profile = currentContext.profile ?? (shouldUseEnv({}) ? "env" : "default");
  const chip = currentContext.chipId ?? "auto";
  const session = currentContext.agentSessionId ? shortId(currentContext.agentSessionId, 8) : "none";
  const target = currentContext.qid ? `q${currentContext.qid}` : currentContext.couplingId ? `c${currentContext.couplingId}` : "none";
  const profileText = `${dim("profile")} ${success(profile)}`;
  const chipText = `${dim("chip")} ${currentContext.chipId ? success(chip) : warn(chip)}`;
  const targetText = `${dim("target")} ${currentContext.qid || currentContext.couplingId ? success(target) : dim(target)}`;
  const sessionText = `${dim("agent")} ${currentContext.agentSessionId ? success(session) : dim(session)}`;
  return [
    `${accent("◆")} ${accent("QDash")}`,
    `👤 ${profileText}`,
    `${accent("▣")} ${chipText}`,
    `🎯 ${targetText}`,
    `🤖 ${sessionText}`,
  ].join(dim("  │  "));
}

function isQDashContextState(value: unknown): value is QDashContextState {
  if (!value || typeof value !== "object") return false;
  const context = value as QDashContextState;
  return [context.profile, context.chipId, context.agentSessionId, context.qid, context.couplingId, context.taskName, context.lastExecutionId, context.lastTaskId]
    .every((item) => item === undefined || typeof item === "string");
}

function loadGlobalContext(): QDashContextState {
  try {
    if (!existsSync(GLOBAL_CONTEXT_PATH)) return {};
    const data = JSON.parse(readFileSync(GLOBAL_CONTEXT_PATH, "utf8"));
    return isQDashContextState(data) ? data : {};
  } catch {
    return {};
  }
}

function saveGlobalContext(context: QDashContextState): void {
  mkdirSync(dirname(GLOBAL_CONTEXT_PATH), { recursive: true });
  writeFileSync(GLOBAL_CONTEXT_PATH, `${JSON.stringify(context, null, 2)}\n`, "utf8");
}

function adoptContextFromToolInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const params = input as { profile?: unknown; chipId?: unknown; sessionId?: unknown; qid?: unknown; couplingId?: unknown; taskName?: unknown; taskId?: unknown; executionId?: unknown; useEnv?: unknown };
  let changed = false;

  if (typeof params.profile === "string" && params.profile.trim()) {
    const profile = params.profile.trim();
    if (currentContext.profile !== profile) {
      const { chipId: _chipId, ...rest } = currentContext;
      currentContext = { ...rest, profile };
      changed = true;
    }
  } else if (params.useEnv === true && currentContext.profile !== undefined) {
    const { profile: _profile, chipId: _chipId, ...rest } = currentContext;
    currentContext = rest;
    changed = true;
  }

  if (typeof params.chipId === "string" && params.chipId.trim() && currentContext.chipId !== params.chipId.trim()) {
    currentContext = { ...currentContext, chipId: params.chipId.trim() };
    changed = true;
  }

  if (typeof params.sessionId === "string" && params.sessionId.trim() && currentContext.agentSessionId !== params.sessionId.trim()) {
    currentContext = { ...currentContext, agentSessionId: params.sessionId.trim() };
    changed = true;
  }

  if (typeof params.qid === "string" && params.qid.trim() && currentContext.qid !== params.qid.trim()) {
    const { couplingId: _couplingId, ...rest } = currentContext;
    currentContext = { ...rest, qid: params.qid.trim() };
    changed = true;
  }

  if (typeof params.couplingId === "string" && params.couplingId.trim() && currentContext.couplingId !== params.couplingId.trim()) {
    const { qid: _qid, ...rest } = currentContext;
    currentContext = { ...rest, couplingId: params.couplingId.trim() };
    changed = true;
  }

  if (typeof params.taskName === "string" && params.taskName.trim() && currentContext.taskName !== params.taskName.trim()) {
    currentContext = { ...currentContext, taskName: params.taskName.trim() };
    changed = true;
  }

  if (typeof params.taskId === "string" && params.taskId.trim() && currentContext.lastTaskId !== params.taskId.trim()) {
    currentContext = { ...currentContext, lastTaskId: params.taskId.trim() };
    changed = true;
  }

  if (typeof params.executionId === "string" && params.executionId.trim() && currentContext.lastExecutionId !== params.executionId.trim()) {
    currentContext = { ...currentContext, lastExecutionId: params.executionId.trim() };
    changed = true;
  }

  return changed;
}

function shortId(value: string, length = 10): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

const QueryAction = Type.Union([
  Type.Literal("chips"),
  Type.Literal("default_chip"),
  Type.Literal("metrics_config"),
  Type.Literal("chip_metrics"),
  Type.Literal("chip_qubits"),
  Type.Literal("chip_qubit"),
  Type.Literal("chip_couplings"),
  Type.Literal("chip_coupling"),
  Type.Literal("cryostats"),
  Type.Literal("cryostat"),
  Type.Literal("cooldowns"),
  Type.Literal("cooldown"),
  Type.Literal("cooldown_wiring_events"),
  Type.Literal("timeseries"),
  Type.Literal("task_results"),
  Type.Literal("task_result"),
  Type.Literal("task_note"),
  Type.Literal("task_result_issues"),
  Type.Literal("qubit_latest"),
  Type.Literal("qubit_history"),
  Type.Literal("coupling_latest"),
  Type.Literal("coupling_history"),
  Type.Literal("tasks"),
  Type.Literal("task_knowledge"),
  Type.Literal("task_knowledge_markdown"),
  Type.Literal("projects"),
  Type.Literal("project"),
  Type.Literal("files_tree"),
  Type.Literal("file_content"),
  Type.Literal("git_status"),
  Type.Literal("issues"),
  Type.Literal("issue_knowledge"),
  Type.Literal("flows"),
  Type.Literal("flow"),
  Type.Literal("flow_templates"),
  Type.Literal("flow_template"),
  Type.Literal("flow_helper_files"),
  Type.Literal("flow_helper_file"),
  Type.Literal("executions"),
  Type.Literal("execution"),
  Type.Literal("ai_reviews"),
  Type.Literal("ai_review_runs"),
  Type.Literal("ai_review_run"),
  Type.Literal("forum_posts"),
  Type.Literal("provenance_stats"),
  Type.Literal("provenance_history"),
  Type.Literal("provenance_changes"),
  Type.Literal("provenance_lineage"),
  Type.Literal("provenance_impact"),
]);

const connectionParams = {
  profile: Type.Optional(Type.String({ description: "QDash profile name. Defaults to env when QDASH_BASE_URL is set, otherwise 'default'." })),
  configPath: Type.Optional(Type.String({ description: "Optional path to qdash config.ini." })),
  useEnv: Type.Optional(Type.Boolean({ description: "Force QDASH_* environment variables instead of a profile." })),
};

const paginationParams = {
  limit: Type.Optional(Type.Number()),
  skip: Type.Optional(Type.Number()),
  offset: Type.Optional(Type.Number()),
};

const chipScopedParams = {
  chipId: Type.Optional(Type.String({ description: "Chip ID. Defaults to the active/default chip when omitted." })),
};

const querySchema = Type.Object({
  ...connectionParams,
  action: QueryAction,
  chipId: Type.Optional(Type.String({ description: "Chip ID. Defaults to the active/default chip for chip-scoped actions when omitted." })),
  qid: Type.Optional(Type.String()),
  couplingId: Type.Optional(Type.String()),
  cryoId: Type.Optional(Type.String()),
  cooldownId: Type.Optional(Type.String()),
  taskId: Type.Optional(Type.String()),
  taskName: Type.Optional(Type.String()),
  task: Type.Optional(Type.String({ description: "Task parameter used by latest/history endpoints." })),
  projectId: Type.Optional(Type.String()),
  path: Type.Optional(Type.String({ description: "Project file path for file_content." })),
  flowName: Type.Optional(Type.String()),
  templateId: Type.Optional(Type.String()),
  filename: Type.Optional(Type.String()),
  executionId: Type.Optional(Type.String()),
  reviewRunId: Type.Optional(Type.String()),
  entityId: Type.Optional(Type.String()),
  parameter: Type.Optional(Type.String({ description: "Metric/parameter name for timeseries." })),
  parameterName: Type.Optional(Type.String()),
  tag: Type.Optional(Type.String()),
  date: Type.Optional(Type.String({ description: "History date, usually YYYYMMDD." })),
  backend: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  decision: Type.Optional(Type.String()),
  username: Type.Optional(Type.String()),
  messageContains: Type.Optional(Type.String()),
  startAt: Type.Optional(Type.String()),
  endAt: Type.Optional(Type.String()),
  startFrom: Type.Optional(Type.String()),
  startTo: Type.Optional(Type.String()),
  isClosed: Type.Optional(Type.Boolean()),
  latestOnly: Type.Optional(Type.Boolean()),
  withinHours: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number()),
  skip: Type.Optional(Type.Number()),
  offset: Type.Optional(Type.Number()),
});

function shouldUseEnv(params: { useEnv?: boolean; profile?: string; configPath?: string }): boolean {
  if (params.useEnv !== undefined) return params.useEnv;
  return !params.profile && !params.configPath && Boolean(process.env.QDASH_BASE_URL);
}

async function makeClient(params: { useEnv?: boolean; profile?: string; configPath?: string }): Promise<QDashClient> {
  params = applyQDashContext(params);
  if (shouldUseEnv(params)) return QDashClient.fromEnv();
  return QDashClient.fromProfile(params.profile ?? "default", params.configPath);
}

async function defaultChipId(client: QDashClient, chipId?: string): Promise<string> {
  return chipId ?? currentContext.chipId ?? client.getDefaultChipId();
}

async function rawGet<T>(client: QDashClient, path: string, query?: Record<string, unknown>): Promise<T> {
  return (client as unknown as { get<T>(path: string, query?: Record<string, unknown>): Promise<T> }).get(path, cleanQuery(query));
}

type TaskResultFigureFile = DownloadedFile & {
  path: string;
  figurePaths: string[];
  jsonFigurePaths: string[];
};

function cleanQuery(values: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null));
}

function pathPart(value: string): string {
  return encodeURIComponent(value);
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for this QDash action`);
  return value;
}

type CooldownRecord = {
  cooldown_id: string;
  cryo_id: string;
  description?: string;
  started_at: string;
  ended_at?: string | null;
  chip_ids?: string[];
  wiring_info?: string;
  wiring_blocks?: Record<string, unknown>[];
};

type CooldownListResponse = { cooldowns?: CooldownRecord[] };

type CooldownWiringParams = {
  profile?: string;
  configPath?: string;
  useEnv?: boolean;
  chipId?: string;
  cryoId?: string;
  cooldownId?: string;
  includeBlocks?: boolean;
  includeHistory?: boolean;
  historyLimit?: number;
  includeInsights?: boolean;
};

type WiringInsightParams = CooldownWiringParams & {
  color?: boolean;
};

type AttenuationEntry = {
  mux: string;
  line: "control" | "readout_send";
  totalDb: number;
  components: number[];
  panel?: string;
  hardwarePort?: string;
  qid?: string;
};

type WiringInsights = {
  entries: AttenuationEntry[];
  control: { commonTotalDb?: number; anomalies: AttenuationEntry[]; totals: Record<string, number> };
  readoutSend: { commonTotalDb?: number; anomalies: AttenuationEntry[]; totals: Record<string, number> };
  suggestions: string[];
};

function newestCooldown(cooldowns: CooldownRecord[]): CooldownRecord | undefined {
  return [...cooldowns].sort((a, b) => {
    const activeDifference = Number(a.ended_at != null) - Number(b.ended_at != null);
    if (activeDifference !== 0) return activeDifference;
    return Date.parse(b.started_at || "") - Date.parse(a.started_at || "");
  })[0];
}

function markdownTableRows(markdown: string): string[][] {
  return markdown.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 7 && !cells.every((cell) => /^-+$/.test(cell.replace(/\s/g, ""))));
}

function expandPanelSpec(value: string): string[] {
  return value.split(/[、,]/).flatMap((part) => {
    const token = part.trim();
    if (!token) return [];
    const range = token.match(/^([A-Za-z]+)(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const [, prefix, startText, endText] = range;
      const start = Number(startText);
      const end = Number(endText);
      const step = start <= end ? 1 : -1;
      const panels: string[] = [];
      for (let value = start; step > 0 ? value <= end : value >= end; value += step) panels.push(`${prefix}${value}`);
      return panels;
    }
    return [token];
  });
}

function splitPortsAndPanels(cell: string): { ports: string[]; panels: string[] } {
  const [portsText = cell, panelsText = ""] = cell.split(/\s+\/\s+/, 2);
  return {
    ports: portsText.split(/[、,]/).map((part) => part.trim()).filter(Boolean),
    panels: expandPanelSpec(panelsText),
  };
}

function attenuationNumbers(text: string): number[] {
  return [...text.matchAll(/(?:追加\s*)?(\d+(?:\.\d+)?)\s*dB/gi)].map((match) => Number(match[1])).filter(Number.isFinite);
}

function panelAttenuationTotals(cell: string): Array<{ panels?: string[]; components: number[]; totalDb: number }> {
  const parenthesized = [...cell.matchAll(/([^（）]+)（([^）]+)）/g)].map((match) => {
    const components = attenuationNumbers(match[1]);
    return { panels: expandPanelSpec(match[2]), components, totalDb: components.reduce((sum, value) => sum + value, 0) };
  }).filter((segment) => segment.components.length > 0);
  if (parenthesized.length > 0) return parenthesized;
  const components = attenuationNumbers(cell);
  return components.length > 0 ? [{ components, totalDb: components.reduce((sum, value) => sum + value, 0) }] : [];
}

function mostCommonTotal(entries: AttenuationEntry[]): number | undefined {
  const counts = new Map<number, number>();
  for (const entry of entries) counts.set(entry.totalDb, (counts.get(entry.totalDb) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

function totalHistogram(entries: AttenuationEntry[]): Record<string, number> {
  const histogram: Record<string, number> = {};
  for (const entry of entries) histogram[String(entry.totalDb)] = (histogram[String(entry.totalDb)] ?? 0) + 1;
  return histogram;
}

function analyzeWiringMarkdown(markdown: string | undefined): WiringInsights | undefined {
  if (!markdown) return undefined;
  const rows = markdownTableRows(markdown);
  const dataRows = rows.filter((cells) => /^\d+$/.test(cells[0]));
  const entries: AttenuationEntry[] = [];
  for (const cells of dataRows) {
    const mux = cells[0].padStart(2, "0");
    const muxNumber = Number(cells[0]);
    const control = splitPortsAndPanels(cells[1] ?? "");
    const controlSegments = panelAttenuationTotals(cells[5] ?? "");
    for (let index = 0; index < control.panels.length; index++) {
      const panel = control.panels[index];
      const segment = controlSegments.find((item) => item.panels?.includes(panel)) ?? (controlSegments.length === 1 ? controlSegments[0] : undefined);
      if (!segment) continue;
      entries.push({
        mux,
        line: "control",
        panel,
        hardwarePort: control.ports[index],
        qid: Number.isFinite(muxNumber) ? String(muxNumber * 4 + index) : undefined,
        totalDb: segment.totalDb,
        components: segment.components,
      });
    }
    const readoutSegments = panelAttenuationTotals(cells[6] ?? "");
    const readout = splitPortsAndPanels(cells[2] ?? "");
    if (readoutSegments[0]) {
      entries.push({
        mux,
        line: "readout_send",
        panel: readout.panels[0],
        hardwarePort: readout.ports[0],
        totalDb: readoutSegments[0].totalDb,
        components: readoutSegments[0].components,
      });
    }
  }
  const controlEntries = entries.filter((entry) => entry.line === "control");
  const readoutEntries = entries.filter((entry) => entry.line === "readout_send");
  const controlCommon = mostCommonTotal(controlEntries);
  const readoutCommon = mostCommonTotal(readoutEntries);
  const controlAnomalies = controlCommon === undefined ? [] : controlEntries.filter((entry) => entry.totalDb !== controlCommon);
  const readoutAnomalies = readoutCommon === undefined ? [] : readoutEntries.filter((entry) => entry.totalDb !== readoutCommon);
  const suggestions = [
    controlCommon !== undefined ? `Control の最頻総減衰量は ${controlCommon} dB です。` : undefined,
    controlAnomalies.length > 0
      ? `Control で最頻値と異なるポートが ${controlAnomalies.length} 件あります: ${controlAnomalies.map((entry) => entry.qid ? `q${entry.qid}` : `${entry.mux}/${entry.panel}`).join(", ")}`
      : controlEntries.length > 0 ? "Control の総減衰量は全ポートで揃っています。" : undefined,
    readoutCommon !== undefined ? `Readout send の最頻総減衰量は ${readoutCommon} dB です。` : undefined,
    readoutAnomalies.length > 0
      ? `Readout send で最頻値と異なる MUX が ${readoutAnomalies.length} 件あります: ${readoutAnomalies.map((entry) => `MUX${entry.mux}`).join(", ")}`
      : readoutEntries.length > 0 ? "Readout send の総減衰量は全 MUX で揃っています。" : undefined,
  ].filter((line): line is string => Boolean(line));
  return {
    entries,
    control: { commonTotalDb: controlCommon, anomalies: controlAnomalies, totals: totalHistogram(controlEntries) },
    readoutSend: { commonTotalDb: readoutCommon, anomalies: readoutAnomalies, totals: totalHistogram(readoutEntries) },
    suggestions,
  };
}

function wiringInsightLines(insights: WiringInsights, color = false): string[] {
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const warning = (text: string) => color ? ansi("33", text) : text;
  const formatEntry = (entry: AttenuationEntry) => `${entry.qid ? `q${entry.qid}` : `MUX${entry.mux}`} ${muted(`MUX${entry.mux}`)} ${entry.panel ?? ""}${entry.hardwarePort ? `/${entry.hardwarePort}` : ""}: ${warning(`${entry.totalDb} dB`)} (${entry.components.join("+")})`;
  return boxed("QDash Wiring Insights", [
    ...insights.suggestions.map((line) => `• ${line}`),
    "",
    accent("Control totals"),
    `  ${Object.entries(insights.control.totals).map(([total, count]) => `${total} dB × ${count}`).join(", ") || muted("none")}`,
    ...(insights.control.anomalies.length > 0 ? ["", accent("Control anomalies"), ...insights.control.anomalies.map((entry) => `  ${formatEntry(entry)}`)] : []),
    "",
    accent("Readout send totals"),
    `  ${Object.entries(insights.readoutSend.totals).map(([total, count]) => `${total} dB × ${count}`).join(", ") || muted("none")}`,
    ...(insights.readoutSend.anomalies.length > 0 ? ["", accent("Readout send anomalies"), ...insights.readoutSend.anomalies.map((entry) => `  ${formatEntry(entry)}`)] : []),
  ], color);
}

async function resolveCooldownWiring(params: CooldownWiringParams) {
  params = applyQDashContext(params);
  const client = await makeClient(params);
  let selection: string;
  let cooldown: CooldownRecord;
  let resolvedChipId = params.chipId ?? currentContext.chipId;

  if (params.cooldownId) {
    cooldown = await rawGet<CooldownRecord>(client, `/cooldowns/${pathPart(params.cooldownId)}`);
    selection = "explicit cooldownId";
  } else {
    resolvedChipId = params.chipId ?? (params.cryoId ? undefined : await defaultChipId(client));
    const response = await rawGet<CooldownListResponse>(client, "/cooldowns", {
      cryo_id: params.cryoId,
      chip_id: resolvedChipId,
    });
    const selected = newestCooldown(response.cooldowns ?? []);
    if (!selected) {
      const scope = params.cryoId ? `cryo ${params.cryoId}` : `chip ${resolvedChipId}`;
      throw new Error(`No cooldown containing wiring information was found for ${scope}`);
    }
    cooldown = await rawGet<CooldownRecord>(client, `/cooldowns/${pathPart(selected.cooldown_id)}`);
    selection = params.cryoId ? "active/newest cooldown for cryo" : "active/newest cooldown for chip";
  }

  const blocks = Array.isArray(cooldown.wiring_blocks) ? cooldown.wiring_blocks : [];
  const wiringInfo = typeof cooldown.wiring_info === "string" ? cooldown.wiring_info.trim() : "";
  const includeBlocks = params.includeBlocks === true || !wiringInfo;
  const history = params.includeHistory
    ? await rawGet(client, `/cooldowns/${pathPart(cooldown.cooldown_id)}/wiring-events`, {
        limit: params.historyLimit ?? 20,
        skip: 0,
      })
    : undefined;
  let cryostat: unknown;
  try {
    cryostat = await rawGet(client, `/cryostats/${pathPart(cooldown.cryo_id)}`);
  } catch {
    // Wiring remains useful on servers where cryostat detail is not accessible.
  }

  const insights = params.includeInsights === true ? analyzeWiringMarkdown(wiringInfo || undefined) : undefined;

  return {
    selection: {
      strategy: selection,
      requested_chip_id: resolvedChipId,
      requested_cryo_id: params.cryoId,
      resolved_cooldown_id: cooldown.cooldown_id,
    },
    cryostat,
    cooldown: {
      cooldown_id: cooldown.cooldown_id,
      cryo_id: cooldown.cryo_id,
      description: cooldown.description,
      started_at: cooldown.started_at,
      ended_at: cooldown.ended_at,
      chip_ids: cooldown.chip_ids ?? [],
    },
    wiring: {
      markdown: wiringInfo || undefined,
      block_count: blocks.length,
      blocks: includeBlocks ? blocks : undefined,
      blocks_omitted: !includeBlocks && blocks.length > 0,
    },
    insights,
    history,
  };
}

function qdashWebBaseUrl(client: QDashClient): string {
  return client.config.baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
}

function qdashWebUrl(client: QDashClient, path: string): string {
  return `${qdashWebBaseUrl(client)}${path.startsWith("/") ? path : `/${path}`}`;
}

function qdashObjectLinks(client: QDashClient, object: Record<string, unknown>): Record<string, string> {
  const links: Record<string, string> = {};
  const taskId = firstString(object, ["task_id", "taskId"]);
  const executionId = firstString(object, ["execution_id", "executionId"]);
  const postId = firstString(object, ["post_id", "forum_post_id", "id"]);
  const issueId = firstString(object, ["issue_id"]);
  const sessionId = firstString(object, ["session_id", "sessionId"]);
  if (taskId) links.task_result = qdashWebUrl(client, `/task-results/${encodeURIComponent(taskId)}`);
  if (executionId) links.execution = qdashWebUrl(client, `/executions/${encodeURIComponent(executionId)}`);
  if (postId) links.forum_post = qdashWebUrl(client, `/forum/posts/${encodeURIComponent(postId)}`);
  if (issueId) links.issue = qdashWebUrl(client, `/issues/${encodeURIComponent(issueId)}`);
  if (sessionId) links.agent_session = qdashWebUrl(client, `/agent-sessions/${encodeURIComponent(sessionId)}`);
  return links;
}

function withQDashLinks(client: QDashClient, data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const object = data as Record<string, unknown>;
  const links = qdashObjectLinks(client, object);
  if (Object.keys(links).length === 0) return data;
  return { ...object, _links: links };
}

function safeConfig(client: QDashClient, source: string) {
  const config = client.config;
  return {
    source,
    baseUrl: config.baseUrl,
    projectId: config.projectId ?? null,
    timeoutSeconds: config.timeoutSeconds,
    verifyTls: config.verifyTls,
    proxyConfigured: Boolean(config.proxy),
    apiTokenConfigured: Boolean(config.apiToken),
    cloudflareAccessConfigured: Boolean(config.cfAccessClientId || config.cfAccessClientSecret),
    userAgent: config.userAgent,
    retry: config.retry,
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (/token|password|secret|authorization|api[_-]?key/i.test(key)) return [key, "[redacted]"];
        return [key, redact(item)];
      }),
    );
  }
  return value;
}

function toToolResult(data: unknown, details: Record<string, unknown> = {}) {
  const safeData = redact(data);
  let text = JSON.stringify(safeData, null, 2);
  if (text.length > 20_000) text = `${text.slice(0, 20_000)}\n... [truncated]`;
  return {
    content: [{ type: "text" as const, text }],
    details: { ...details, data: safeData },
  };
}

function toTextToolResult(text: string, data: unknown, details: Record<string, unknown> = {}) {
  const safeData = redact(data);
  return {
    content: [{ type: "text" as const, text }],
    details: { ...details, data: safeData },
  };
}

function configProfiles(configPath = defaultConfigPath()): { path: string; exists: boolean; profiles: string[] } {
  if (!existsSync(configPath)) return { path: configPath, exists: false, profiles: [] };
  const contents = readFileSync(configPath, "utf8");
  const profiles = [...contents.matchAll(/^\s*\[([^\]]+)]\s*$/gm)].map((m) => m[1]);
  return { path: configPath, exists: true, profiles };
}

function arrayFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const object = payload as Record<string, unknown>;
    for (const key of ["items", "results", "data", "issues", "executions", "chips", "tasks", "insights"]) {
      if (Array.isArray(object[key])) return object[key];
    }
  }
  return [];
}

function compactItems(payload: unknown, keys: string[], limit: number): Record<string, unknown>[] {
  return arrayFromPayload(payload).slice(0, limit).map((item) => {
    if (!item || typeof item !== "object") return { value: item };
    const object = item as Record<string, unknown>;
    return Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, object[key]]));
  });
}

function payloadTotal(payload: unknown): number {
  const fallback = arrayFromPayload(payload).length;
  if (!payload || typeof payload !== "object") return fallback;
  const object = payload as Record<string, unknown>;
  for (const key of ["total", "total_count", "count", "total_items"]) {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function firstString(object: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function statusIcon(status: string | undefined): string {
  const normalized = status?.toLowerCase() ?? "";
  if (["completed", "success", "succeeded", "active", "applied"].includes(normalized)) return "✓";
  if (["failed", "error", "crashed"].includes(normalized)) return "✗";
  if (["running", "pending", "queued", "in_progress"].includes(normalized)) return "…";
  if (["cancelled", "canceled"].includes(normalized)) return "-";
  return "•";
}

function formatItem(item: Record<string, unknown>, fallbackId: string): string {
  const id = firstString(item, ["issue_id", "execution_id", "flow_run_id", "task_id", "id"]) ?? fallbackId;
  const title = firstString(item, ["title", "task_name", "flow_name", "name"]);
  const status = firstString(item, ["status", "execution_status", "activity_status"]);
  const target = firstString(item, ["qid", "coupling_id"]);
  return [statusIcon(status), shortId(id, 14), title, target ? `(${target})` : undefined, status ? `[${status}]` : undefined]
    .filter(Boolean)
    .join(" ");
}

async function buildDashboard(params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; limit?: number }) {
  params = applyQDashContext(params);
  const limit = params.limit ?? 5;
  const client = await makeClient(params);
  const chipId = await defaultChipId(client, params.chipId);
  const [chips, openIssues, recentExecutions, failedTaskResults, provenanceStats] = await Promise.allSettled([
    client.listChips(),
    rawGet(client, "/issues", { is_closed: false, limit }),
    rawGet(client, "/executions", { chip_id: chipId, limit }),
    rawGet(client, "/task-results", { chip_id: chipId, status: "failed", limit }),
    client.getProvenanceStats(),
  ]);
  const value = <T>(result: PromiseSettledResult<T>): T | { error: string } => result.status === "fulfilled" ? result.value : { error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
  const issuesPayload = value(openIssues);
  const executionsPayload = value(recentExecutions);
  const failedTasksPayload = value(failedTaskResults);
  return {
    context: { ...currentContext, profile: params.profile ?? currentContext.profile, chipId },
    chips: value(chips),
    openIssues: {
      count: payloadTotal(issuesPayload),
      shown: arrayFromPayload(issuesPayload).length,
      items: compactItems(issuesPayload, ["issue_id", "id", "title", "task_id", "is_closed", "severity", "created_at"], limit),
      raw: issuesPayload,
    },
    recentExecutions: {
      count: payloadTotal(executionsPayload),
      shown: arrayFromPayload(executionsPayload).length,
      items: compactItems(executionsPayload, ["execution_id", "flow_run_id", "flow_name", "status", "created_at", "started_at", "finished_at"], limit),
      raw: executionsPayload,
    },
    failedTaskResults: {
      count: payloadTotal(failedTasksPayload),
      shown: arrayFromPayload(failedTasksPayload).length,
      items: compactItems(failedTasksPayload, ["task_id", "task_name", "status", "qid", "coupling_id", "start_at", "created_at"], limit),
      raw: failedTasksPayload,
    },
    provenanceStats: value(provenanceStats),
  };
}

function ansi(code: string, text: string): string {
  return `\u001b[${code}m${text}\u001b[0m`;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function displayWidth(text: string): number {
  return visibleWidth(stripAnsi(text));
}

function padAnsi(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

function truncateDisplay(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  const ellipsis = "…";
  const target = Math.max(0, width - visibleWidth(ellipsis));
  let out = "";
  let used = 0;
  for (const char of Array.from(text)) {
    const charWidth = visibleWidth(char);
    if (used + charWidth > target) break;
    out += char;
    used += charWidth;
  }
  return out + ellipsis;
}

function boxed(title: string, body: string[], color = false): string[] {
  const plainTitle = ` ${title} `;
  const contentWidth = Math.min(
    92,
    Math.max(36, ...body.map((line) => displayWidth(line)), visibleWidth(plainTitle)),
  );
  const innerWidth = contentWidth + 2;
  const borderColor = (text: string) => color ? ansi("90", text) : text;
  const titleText = color ? ansi("1;36", plainTitle) : plainTitle;
  const top = borderColor("╭") + titleText + borderColor("─".repeat(Math.max(0, innerWidth - plainTitle.length))) + borderColor("╮");
  const bottom = borderColor("╰" + "─".repeat(innerWidth) + "╯");
  return [
    top,
    ...body.map((line) => {
      const clipped = color ? truncateToWidth(line, contentWidth) : truncateDisplay(line, contentWidth);
      return `${borderColor("│")} ${padAnsi(clipped, contentWidth)} ${borderColor("│")}`;
    }),
    bottom,
  ];
}

function dashboardLines(dashboard: Awaited<ReturnType<typeof buildDashboard>>, color = false): string[] {
  const chips = arrayFromPayload(dashboard.chips);
  const profile = dashboard.context.profile ?? "env/default";
  const session = dashboard.context.agentSessionId ? shortId(dashboard.context.agentSessionId) : "none";
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const dim = (text: string) => color ? ansi("2", text) : text;
  const success = (text: string) => color ? ansi("32", text) : text;
  const warning = (text: string) => color ? ansi("33", text) : text;
  const error = (text: string) => color ? ansi("31", text) : text;
  const issueCount = dashboard.openIssues.count > 0 ? warning(String(dashboard.openIssues.count)) : success(String(dashboard.openIssues.count));
  const failedCount = dashboard.failedTaskResults.count > 0 ? error(`${dashboard.failedTaskResults.shown}/${dashboard.failedTaskResults.count}`) : success(`${dashboard.failedTaskResults.shown}/${dashboard.failedTaskResults.count}`);
  return boxed("QDash Harness", [
    `${muted("profile")} ${accent(profile)}   ${muted("chip")} ${accent(dashboard.context.chipId)}   ${muted("session")} ${dim(session)}`,
    `${muted("chips")} ${success(String(chips.length))}   ${muted("open issues")} ${issueCount}   ${muted("executions")} ${accent(`${dashboard.recentExecutions.shown}/${dashboard.recentExecutions.count}`)}   ${muted("failed tasks")} ${failedCount}`,
    "",
    accent("Open issues"),
    ...(dashboard.openIssues.items.length > 0 ? dashboard.openIssues.items.map((item, index) => `  ${warning(formatItem(item, `issue-${index + 1}`))}`) : [`  ${dim("none")}`]),
    "",
    accent("Recent executions"),
    ...(dashboard.recentExecutions.items.length > 0 ? dashboard.recentExecutions.items.map((item, index) => `  ${muted(formatItem(item, `exec-${index + 1}`))}`) : [`  ${dim("none")}`]),
    "",
    accent("Failed task results"),
    ...(dashboard.failedTaskResults.items.length > 0 ? dashboard.failedTaskResults.items.map((item, index) => `  ${error(formatItem(item, `task-${index + 1}`))}`) : [`  ${dim("none")}`]),
  ], color);
}

function styledDashboardLines(dashboard: Awaited<ReturnType<typeof buildDashboard>>, theme: Theme): string[] {
  const chips = arrayFromPayload(dashboard.chips);
  const profile = dashboard.context.profile ?? "env/default";
  const session = dashboard.context.agentSessionId ? shortId(dashboard.context.agentSessionId) : "none";
  const issueColor = dashboard.openIssues.count > 0 ? "warning" : "success";
  const failedColor = dashboard.failedTaskResults.count > 0 ? "error" : "success";
  return [
    theme.fg("accent", theme.bold("QDash Harness")),
    `${theme.fg("muted", "profile")} ${theme.fg("accent", profile)}  ${theme.fg("muted", "chip")} ${theme.fg("accent", dashboard.context.chipId)}  ${theme.fg("muted", "session")} ${theme.fg("dim", session)}`,
    "",
    [
      `${theme.fg("muted", "chips")} ${theme.fg("success", String(chips.length))}`,
      `${theme.fg("muted", "open issues")} ${theme.fg(issueColor, String(dashboard.openIssues.count))}`,
      `${theme.fg("muted", "executions")} ${theme.fg("accent", `${dashboard.recentExecutions.shown}/${dashboard.recentExecutions.count}`)}`,
      `${theme.fg("muted", "failed tasks")} ${theme.fg(failedColor, `${dashboard.failedTaskResults.shown}/${dashboard.failedTaskResults.count}`)}`,
    ].join("   "),
    "",
    theme.fg("borderAccent", "Open issues"),
    ...(dashboard.openIssues.items.length > 0
      ? dashboard.openIssues.items.map((item, index) => `  ${theme.fg("warning", formatItem(item, `issue-${index + 1}`))}`)
      : [`  ${theme.fg("dim", "none")}`]),
    "",
    theme.fg("borderAccent", "Recent executions"),
    ...(dashboard.recentExecutions.items.length > 0
      ? dashboard.recentExecutions.items.map((item, index) => `  ${theme.fg("muted", formatItem(item, `exec-${index + 1}`))}`)
      : [`  ${theme.fg("dim", "none")}`]),
    "",
    theme.fg("borderAccent", "Failed task results"),
    ...(dashboard.failedTaskResults.items.length > 0
      ? dashboard.failedTaskResults.items.map((item, index) => `  ${theme.fg("error", formatItem(item, `task-${index + 1}`))}`)
      : [`  ${theme.fg("dim", "none")}`]),
  ];
}

function dashboardComponent(dashboard: Awaited<ReturnType<typeof buildDashboard>>, theme: Theme) {
  return {
    render(width: number) {
      const border = theme.fg("borderMuted", "─".repeat(Math.max(0, Math.min(width, 80))));
      return [border, ...styledDashboardLines(dashboard, theme), border].map((line) => truncateToWidth(line, width));
    },
    invalidate() {},
  };
}

type RecentCalibrationSummary = {
  context: { profile?: string; chipId: string; webBaseUrl: string };
  items: Record<string, unknown>[];
  groups: Array<{ target: string; status: string; summary: string; latest: Record<string, unknown>; links: Record<string, string> }>;
};

function calibrationTarget(item: Record<string, unknown>): string {
  const qid = firstString(item, ["qid"]);
  if (qid) return `q${qid}`;
  const coupling = firstString(item, ["coupling_id", "couplingId"]);
  if (coupling) return `c${coupling}`;
  return "global";
}

function calibrationSummaryForTarget(items: Record<string, unknown>[]): { status: string; summary: string; latest: Record<string, unknown> } {
  const latest = items[0] ?? {};
  const latestTask = firstString(latest, ["task_name", "name"]) ?? "task";
  const latestStatus = firstString(latest, ["status"]) ?? "unknown";
  const latestMessage = firstString(latest, ["message"]);
  const hadFailedRabi = items.some((item) => firstString(item, ["task_name", "name"]) === "CheckRabi" && firstString(item, ["status"]) === "failed");
  const hasConfigure = items.some((item) => firstString(item, ["task_name", "name"]) === "Configure" && firstString(item, ["status"]) === "completed");
  const latestIsSuccessfulRabi = latestTask === "CheckRabi" && latestStatus === "completed";
  if (latestIsSuccessfulRabi && (hadFailedRabi || hasConfigure)) {
    return { status: "recovered", summary: "CheckRabi completed after recovery sequence", latest };
  }
  if (latestStatus === "failed" && ["CheckChevron", "CheckQubitSpectroscopy"].includes(latestTask)) {
    return { status: "blocked", summary: latestMessage ?? `${latestTask} failed; stop and review figures/settings`, latest };
  }
  if (latestStatus === "failed") return { status: "failed", summary: latestMessage ?? `${latestTask} failed`, latest };
  if (latestStatus === "completed") return { status: "ok", summary: `${latestTask} completed`, latest };
  return { status: latestStatus, summary: `${latestTask} ${latestStatus}`, latest };
}

async function buildRecentCalibrationSummary(params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; limit?: number; withinHours?: number }): Promise<RecentCalibrationSummary> {
  params = applyQDashContext(params);
  const client = await makeClient(params);
  const chipId = await defaultChipId(client, params.chipId);
  const end = new Date();
  const start = new Date(end.getTime() - (params.withinHours ?? 24) * 3600_000);
  const payload = await rawGet(client, "/task-results", { chip_id: chipId, start_from: start.toISOString(), start_to: end.toISOString(), limit: params.limit ?? 30 });
  const items = arrayFromPayload(payload).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const byTarget = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const target = calibrationTarget(item);
    byTarget.set(target, [...(byTarget.get(target) ?? []), item]);
  }
  const groups = [...byTarget.entries()].map(([target, targetItems]) => {
    const result = calibrationSummaryForTarget(targetItems);
    return { target, ...result, links: qdashObjectLinks(client, result.latest) };
  });
  return { context: { profile: params.profile ?? currentContext.profile, chipId, webBaseUrl: qdashWebBaseUrl(client) }, items, groups };
}

function recentCalibrationSummaryLines(summary: RecentCalibrationSummary, color = false): string[] {
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const statusMark = (status: string) => status === "recovered" || status === "ok" ? "✓" : status === "blocked" || status === "failed" ? "✗" : "•";
  const body = [
    `${muted("profile")} ${accent(summary.context.profile ?? "env/default")}  ${muted("chip")} ${accent(summary.context.chipId)}`,
    `${muted("url")} ${summary.context.webBaseUrl}`,
    "",
    ...(summary.groups.length > 0 ? summary.groups.map((group) => {
      const task = firstString(group.latest, ["task_name", "name"]);
      const exec = firstString(group.latest, ["execution_id"]);
      const taskUrl = group.links.task_result;
      const execUrl = group.links.execution;
      return [
        `${statusMark(group.status)} ${accent(group.target)} ${muted(`[${group.status}]`)} ${task ? `${task}: ` : ""}${group.summary}`,
        taskUrl ? `    ${muted("task")} ${taskUrl}` : undefined,
        execUrl ? `    ${muted("exec")} ${execUrl}` : exec ? `    ${muted("exec")} ${exec}` : undefined,
      ].filter(Boolean).join("\n");
    }) : [muted("no recent calibration task results")]),
  ];
  return boxed("QDash Recent Calibration", body.flatMap((line) => line.split("\n")), color);
}

function recentCalibrationSummaryComponent(summary: RecentCalibrationSummary, theme: Theme) {
  return {
    render(width: number) {
      return recentCalibrationSummaryLines(summary).map((line) => truncateToWidth(line, width));
    },
    invalidate() {},
  };
}

type CalibrationComparison = {
  context: { profile?: string; chipId: string; webBaseUrl: string };
  target: { kind: "qubit" | "coupling"; id: string; label: string };
  compared: Array<{ task: string; before: Record<string, unknown>; after: Record<string, unknown>; changes: Record<string, { before: unknown; after: unknown }> }>;
};

async function buildCalibrationComparison(params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; qid?: string; couplingId?: string; limit?: number; withinHours?: number }): Promise<CalibrationComparison> {
  params = applyQDashContext(params);
  const client = await makeClient(params);
  const chipId = await defaultChipId(client, params.chipId);
  const qid = params.qid ?? (params.couplingId ? undefined : currentContext.qid);
  const couplingId = params.couplingId ?? (params.qid ? undefined : currentContext.couplingId);
  if (!qid && !couplingId) throw new Error("qid or couplingId is required (or select one with /qdash-use-target)");
  const kind = qid ? "qubit" : "coupling";
  const id = (qid ?? couplingId) as string;
  const results = await client.listTaskResults({ chipId, qid, couplingId, limit: Math.max(2, Math.min(100, params.limit ?? 20)) });
  const items = arrayFromPayload(results).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const task = firstString(item, ["task_name", "name"]) ?? "task";
    groups.set(task, [...(groups.get(task) ?? []), item]);
  }
  const compared = [...groups.entries()].flatMap(([task, entries]) => {
    if (entries.length < 2) return [];
    const after = entries[0];
    const before = entries[1];
    const beforeParams = (before.output_parameters ?? {}) as Record<string, unknown>;
    const afterParams = (after.output_parameters ?? {}) as Record<string, unknown>;
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const name of new Set([...Object.keys(beforeParams), ...Object.keys(afterParams)])) {
      const beforeValue = parameterValue(beforeParams[name]);
      const afterValue = parameterValue(afterParams[name]);
      if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) changes[name] = { before: beforeValue, after: afterValue };
    }
    return [{ task, before, after, changes }];
  });
  return { context: { profile: params.profile ?? currentContext.profile, chipId, webBaseUrl: qdashWebBaseUrl(client) }, target: { kind, id, label: kind === "qubit" ? `q${id}` : `c${id}` }, compared };
}

function parameterValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) return (value as { value?: unknown }).value;
  return value;
}

function calibrationComparisonLines(comparison: CalibrationComparison, color = false): string[] {
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const lines = [`profile ${comparison.context.profile ?? "env/default"}  chip ${comparison.context.chipId}`, `target ${comparison.target.label}`, ""];
  if (comparison.compared.length === 0) lines.push(muted("Not enough repeated task results to compare."));
  for (const item of comparison.compared) {
    lines.push(accent(item.task));
    const beforeId = firstString(item.before, ["task_id", "id"]) ?? "before";
    const afterId = firstString(item.after, ["task_id", "id"]) ?? "after";
    lines.push(`  before ${shortId(beforeId, 18)}  after ${shortId(afterId, 18)}`);
    const changes = Object.entries(item.changes);
    if (changes.length === 0) lines.push(`  ${muted("no output-parameter changes")}`);
    else for (const [name, change] of changes) lines.push(`  ${name}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`);
  }
  return boxed("QDash Calibration Comparison", lines, color);
}

type InvestigationReport = {
  context: { profile?: string; chipId: string; webBaseUrl: string };
  recent: RecentCalibrationSummary;
  target?: TargetOperationsReport;
  insights?: DashboardInsightsResult;
};

async function buildInvestigationReport(params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; qid?: string; couplingId?: string; limit?: number; withinHours?: number }): Promise<InvestigationReport> {
  params = applyQDashContext(params);
  const recent = await buildRecentCalibrationSummary(params);
  const qid = params.qid ?? currentContext.qid;
  const couplingId = params.couplingId ?? currentContext.couplingId;
  if (qid || couplingId) {
    const target = await buildTargetOperationsReport({ ...params, qid, couplingId });
    return { context: recent.context, recent, target };
  }
  const insights = await buildDashboardInsights(params);
  return { context: recent.context, recent, insights };
}

function investigationLines(report: InvestigationReport, color = false): string[] {
  const sections = boxed("QDash Investigation", [
    `profile ${report.context.profile ?? "env/default"}  chip ${report.context.chipId}`,
    "",
    "Recent calibration",
    ...recentCalibrationSummaryLines(report.recent, color).slice(2, -1),
    ...(report.target ? ["", ...targetOperationsReportLines(report.target, color).slice(2, -1)] : []),
    ...(report.insights ? ["", ...dashboardInsightLines(report.insights, color).slice(2, -1)] : []),
    "",
    "read-only investigation; no task execution or parameter changes",
  ], color);
  return sections;
}

type TargetOperationsReport = {
  context: { profile?: string; chipId: string; webBaseUrl: string };
  target: { kind: "qubit" | "coupling"; id: string; label: string };
  latestTarget: unknown;
  recentResults: Record<string, unknown>[];
  failures: Record<string, unknown>[];
  issues: Record<string, unknown>[];
  forumPosts: Record<string, unknown>[];
  recommendation: RecommendedNextAction | null;
};

type RecommendedNextAction = {
  target: string;
  recommendation: string;
  reason: string;
  status: string;
  links: Record<string, string>;
  latest?: Record<string, unknown>;
};

function recommendFromCalibrationSummary(summary: RecentCalibrationSummary, requestedTarget?: string): RecommendedNextAction[] {
  const groups = requestedTarget ? summary.groups.filter((group) => group.target === requestedTarget || group.target === `q${requestedTarget}` || group.target === `c${requestedTarget}`) : summary.groups;
  return groups.map((group) => {
    const task = firstString(group.latest, ["task_name", "name"]);
    const message = firstString(group.latest, ["message"]) ?? group.summary;
    if (group.status === "recovered") {
      return { target: group.target, status: "done", recommendation: "Inspect candidates; commit/apply only after explicit confirmation if this result should become authoritative.", reason: group.summary, links: group.links, latest: group.latest };
    }
    if (task === "CheckRabi" && group.status === "failed" && /non-finite|nan|R²|R2/i.test(message)) {
      return { target: group.target, status: "next", recommendation: "Run CheckChevron. If it succeeds, run Configure, then validate with CheckRabi.", reason: message, links: group.links, latest: group.latest };
    }
    if (task === "CheckChevron" && group.status === "blocked") {
      return { target: group.target, status: "stop", recommendation: "Stop automatic recovery; inspect figures and run/inspect CheckQubitSpectroscopy before Configure or Rabi retry.", reason: message, links: group.links, latest: group.latest };
    }
    if (task === "CheckQubitSpectroscopy" && group.status === "blocked") {
      return { target: group.target, status: "human", recommendation: "Request human review; frequency detection is outside operating range and candidates are unsafe.", reason: message, links: group.links, latest: group.latest };
    }
    if (group.status === "blocked" || group.status === "failed") {
      return { target: group.target, status: "review", recommendation: "Inspect task figures and recent history before another operational action.", reason: message, links: group.links, latest: group.latest };
    }
    return { target: group.target, status: "ok", recommendation: "No immediate recovery action suggested.", reason: group.summary, links: group.links, latest: group.latest };
  });
}

async function buildTargetOperationsReport(params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; qid?: string; couplingId?: string; limit?: number; withinHours?: number }): Promise<TargetOperationsReport> {
  params = applyQDashContext(params);
  const client = await makeClient(params);
  const chipId = await defaultChipId(client, params.chipId);
  const qid = params.qid ?? (params.couplingId ? undefined : currentContext.qid);
  const couplingId = params.couplingId ?? (params.qid ? undefined : currentContext.couplingId);
  if (!qid && !couplingId) throw new Error("qid or couplingId is required (or select one with /qdash-use-target)");
  const kind = qid ? "qubit" : "coupling";
  const id = qid ?? couplingId as string;
  const label = kind === "qubit" ? `q${id}` : `c${id}`;
  const end = new Date();
  const start = new Date(end.getTime() - (params.withinHours ?? 168) * 3600_000);
  const limit = Math.max(1, Math.min(100, params.limit ?? 10));
  const [latestTarget, results, issues, forumPosts] = await Promise.all([
    kind === "qubit" ? client.getChipQubit(chipId, id) : client.getChipCoupling(chipId, id),
    client.listTaskResults({ chipId, qid, couplingId, startAt: start.toISOString(), endAt: end.toISOString(), limit }),
    rawGet(client, "/issues", { is_closed: false, limit: 100 }),
    client.listForumPosts({ chipId, status: "open", targetType: kind, targetId: id, limit }),
  ]);
  const recentResults = arrayFromPayload(results).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const taskIds = new Set(recentResults.map((item) => firstString(item, ["task_id", "taskId"])).filter((item): item is string => Boolean(item)));
  const targetIssues = arrayFromPayload(issues).filter((item): item is Record<string, unknown> => {
    if (!item || typeof item !== "object") return false;
    const issue = item as Record<string, unknown>;
    return (firstString(issue, ["task_id", "taskId"]) && taskIds.has(firstString(issue, ["task_id", "taskId"])!)) || targetFromText(firstString(issue, ["title", "summary"]) ?? "") === label;
  });
  const summary: RecentCalibrationSummary = { context: { profile: params.profile ?? currentContext.profile, chipId, webBaseUrl: qdashWebBaseUrl(client) }, items: recentResults, groups: [] };
  const groups = new Map<string, Record<string, unknown>[]>();
  groups.set(label, recentResults);
  summary.groups = [...groups.entries()].map(([target, items]) => ({ target, ...calibrationSummaryForTarget(items), links: qdashObjectLinks(client, items[0] ?? {}) }));
  const recommendation = recommendFromCalibrationSummary(summary, label)[0] ?? null;
  return {
    context: summary.context,
    target: { kind, id, label },
    latestTarget,
    recentResults,
    failures: recentResults.filter((item) => firstString(item, ["status"])?.toLowerCase() === "failed"),
    issues: targetIssues,
    forumPosts: forumPostsFromPayload(forumPosts),
    recommendation,
  };
}

function targetOperationsReportLines(report: TargetOperationsReport, color = false): string[] {
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const warn = (text: string) => color ? ansi("33", text) : text;
  const error = (text: string) => color ? ansi("31", text) : text;
  const resultLine = (item: Record<string, unknown>) => {
    const task = firstString(item, ["task_name", "name"]) ?? "task";
    const status = firstString(item, ["status"]) ?? "unknown";
    const id = firstString(item, ["task_id", "taskId"]) ?? "";
    return `${statusIcon(status)} ${task} [${status}]${id ? ` ${shortId(id, 16)}` : ""}`;
  };
  return boxed(`QDash Target Report ${report.target.label}`, [
    `${muted("profile")} ${accent(report.context.profile ?? "env/default")}  ${muted("chip")} ${accent(report.context.chipId)}`,
    `${muted("results")} ${report.recentResults.length}  ${muted("failures")} ${report.failures.length ? error(String(report.failures.length)) : "0"}  ${muted("issues")} ${report.issues.length ? warn(String(report.issues.length)) : "0"}  ${muted("forum")} ${report.forumPosts.length}`,
    "",
    accent("Recent results"),
    ...(report.recentResults.length ? report.recentResults.slice(0, 10).map(resultLine) : [`  ${muted("none")}`]),
    "",
    accent("Recommendation"),
    ...(report.recommendation ? [`  ${report.recommendation.recommendation}`, `  ${muted("reason")} ${report.recommendation.reason}`] : [`  ${muted("no immediate action suggested")}`]),
  ], color);
}

type CalibrationPlanStep = {
  order: number;
  action: string;
  mode: "inspect" | "diagnostic" | "validate" | "stop";
  requiresConfirmation: boolean;
  reason: string;
};

type CalibrationPlan = {
  context: TargetOperationsReport["context"];
  target: TargetOperationsReport["target"];
  basis: string;
  steps: CalibrationPlanStep[];
  safety: string[];
};

function buildCalibrationPlan(report: TargetOperationsReport): CalibrationPlan {
  const latest = report.recentResults[0] ?? {};
  const task = firstString(latest, ["task_name", "name"]) ?? "";
  const message = firstString(latest, ["message"]) ?? "";
  const failed = report.failures.length > 0;
  const steps: CalibrationPlanStep[] = [{ order: 1, action: `Inspect ${report.target.label} report, figures, history, and forum context`, mode: "inspect", requiresConfirmation: false, reason: "Establish evidence before any operational action." }];

  if (report.target.kind === "qubit" && task === "CheckRabi" && failed && /non-finite|nan|r²|r2/i.test(message)) {
    steps.push(
      { order: 2, action: "CheckChevron", mode: "diagnostic", requiresConfirmation: true, reason: "Recover a non-finite Rabi fit using a same-target diagnostic." },
      { order: 3, action: "Configure", mode: "validate", requiresConfirmation: true, reason: "Only if CheckChevron succeeds with plausible estimates." },
      { order: 4, action: "CheckRabi", mode: "validate", requiresConfirmation: true, reason: "Validate the Chevron-derived operating point without committing candidates." },
    );
  } else if (report.target.kind === "coupling" && failed && /randomized|bell|zx90|cross.?resonance/i.test(`${task} ${message}`)) {
    for (const [index, action] of ["CheckCrossResonance", "CreateZX90", "CheckZX90", "CheckBellState", "CheckBellStateTomography", "ZX90InterleavedRandomizedBenchmarking"].entries()) {
      steps.push({ order: index + 2, action, mode: index === 0 ? "diagnostic" : "validate", requiresConfirmation: true, reason: "Walk back through two-qubit prerequisites before RB validation." });
    }
  } else if (report.recommendation?.status === "stop" || report.recommendation?.status === "human") {
    steps.push({ order: 2, action: "Request human review", mode: "stop", requiresConfirmation: false, reason: report.recommendation.reason });
  } else {
    steps.push({ order: 2, action: "Run the task recommended by the target report", mode: "validate", requiresConfirmation: true, reason: report.recommendation?.reason ?? "No automatic recovery recipe matched; review the evidence first." });
  }

  return {
    context: report.context,
    target: report.target,
    basis: failed ? `Latest failure: ${task || "unknown task"}${message ? ` — ${message}` : ""}` : "No recent failed result matched a recovery recipe.",
    steps,
    safety: [
      "This is a dry-run plan; no task is executed and no parameter is changed.",
      "Confirm each operational step separately.",
      "Do not commit or apply candidates until a validation task succeeds and the user explicitly approves it.",
    ],
  };
}

function calibrationPlanLines(plan: CalibrationPlan, color = false): string[] {
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const mark = (mode: CalibrationPlanStep["mode"]) => mode === "stop" ? "✗" : mode === "inspect" ? "·" : mode === "diagnostic" ? "→" : "✓";
  return boxed(`QDash Dry-run Plan ${plan.target.label}`, [
    `${muted("profile")} ${accent(plan.context.profile ?? "env/default")}  ${muted("chip")} ${accent(plan.context.chipId)}`,
    `${muted("basis")} ${plan.basis}`,
    "",
    ...plan.steps.map((step) => `${mark(step.mode)} ${step.order}. ${step.action} [${step.mode}]${step.requiresConfirmation ? " [confirmation]" : ""}\n    ${muted(step.reason)}`),
    "",
    accent("Safety gates"),
    ...plan.safety.map((item) => `  - ${item}`),
  ], color);
}

type DegradationReport = {
  context: { profile?: string; chipId: string; webBaseUrl: string };
  lock: unknown;
  changes: unknown;
  trends: unknown;
  recommendations?: unknown;
};

async function buildDegradationReport(params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; withinHours?: number; minStreak?: number; limit?: number; entityId?: string }): Promise<DegradationReport> {
  params = applyQDashContext(params);
  const client = await makeClient(params);
  const chipId = await defaultChipId(client, params.chipId);
  const [lock, changes, trends, recommendations] = await Promise.all([
    client.getExecutionLockStatus(),
    client.getRecentChanges({ withinHours: params.withinHours ?? 24, limit: params.limit ?? 20 }),
    client.getDegradationTrends({ minStreak: params.minStreak ?? 3, limit: params.limit ?? 20 }),
    params.entityId ? client.getRecalibrationRecommendations(params.entityId) : Promise.resolve(undefined),
  ]);
  return { context: { profile: params.profile ?? currentContext.profile, chipId, webBaseUrl: qdashWebBaseUrl(client) }, lock, changes, trends, recommendations };
}

function degradationReportLines(report: DegradationReport, color = false): string[] {
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const objectArray = (value: unknown, keys: string[]): Record<string, unknown>[] => {
    const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
    for (const key of keys) if (Array.isArray(payload[key])) return payload[key].filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    return [];
  };
  const changes = objectArray(report.changes, ["changes", "items"]);
  const trends = objectArray(report.trends, ["trends", "items"]);
  const recommendations = objectArray(report.recommendations, ["recommended_tasks", "tasks"]);
  const locked = Boolean(report.lock && typeof report.lock === "object" && (report.lock as Record<string, unknown>).lock);
  return boxed("QDash Degradation Report", [
    `${muted("profile")} ${accent(report.context.profile ?? "env/default")}  ${muted("chip")} ${accent(report.context.chipId)}  ${muted("execution lock")} ${locked ? "LOCKED" : "available"}`,
    `${muted("recent changes")} ${changes.length}  ${muted("degradation trends")} ${trends.length}${report.recommendations ? `  ${muted("recommendations")} ${recommendations.length}` : ""}`,
    "",
    accent("Degradation trends"),
    ...(trends.length ? trends.slice(0, 10).map((item) => `! ${firstString(item, ["parameter_name", "parameter", "name"]) ?? "parameter"} ${firstString(item, ["qid", "target"]) ?? ""} ${firstString(item, ["streak", "severity"]) ?? ""}`) : [`  ${muted("none detected")}`]),
    "",
    accent("Recent changes"),
    ...(changes.length ? changes.slice(0, 10).map((item) => `• ${firstString(item, ["parameter_name", "parameter", "name"]) ?? "parameter"} ${firstString(item, ["qid", "target"]) ?? ""} Δ${firstString(item, ["delta", "delta_percent"]) ?? "?"}`) : [`  ${muted("none")}`]),
    ...(report.recommendations ? ["", accent("Recommended downstream tasks"), ...(recommendations.length ? recommendations.slice(0, 8).map((item) => `→ ${firstString(item, ["task_name", "task", "name"]) ?? JSON.stringify(item)}`) : [`  ${muted("none")}`])] : []),
    "",
    `${accent("safety")} ${locked ? "An execution is active; do not start another calibration action." : "No active execution lock reported. This report is read-only."}`,
  ], color);
}

type CalibrationValidation = {
  context: { profile?: string; chipId?: string; webBaseUrl: string };
  taskId: string;
  task: Record<string, unknown>;
  status: "passed" | "failed" | "needs_review" | "unknown";
  gates: Array<{ name: string; passed: boolean; detail: string }>;
  figurePaths: string[];
  issues: Record<string, unknown>[];
  comparison?: unknown;
  next: string;
  links: Record<string, string>;
};

async function buildCalibrationValidation(params: { profile?: string; configPath?: string; useEnv?: boolean; taskId: string; beforeExecutionId?: string }): Promise<CalibrationValidation> {
  params = applyQDashContext(params);
  const client = await makeClient(params);
  const task = await client.getTaskResult(params.taskId) as unknown as Record<string, unknown>;
  const status = firstString(task, ["status"])?.toLowerCase() ?? "unknown";
  const figurePaths = taskFigurePaths(task, 20);
  const issuesPayload = await rawGet(client, `/task-results/${pathPart(params.taskId)}/issues`).catch(() => []);
  const issues = arrayFromPayload(issuesPayload).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const afterExecutionId = firstString(task, ["execution_id", "executionId"]);
  const comparison = params.beforeExecutionId && afterExecutionId
    ? await client.compareExecutions(params.beforeExecutionId, afterExecutionId).catch(() => undefined)
    : undefined;
  const comparisonRecord = comparison as unknown as Record<string, unknown> | undefined;
  const changedParameters = comparisonRecord ? firstNumber(comparisonRecord, ["changed_count"]) ?? (Array.isArray(comparisonRecord.changed_parameters) ? (comparisonRecord.changed_parameters as unknown[]).length : undefined) : undefined;
  const gates = [
    { name: "task completed", passed: ["completed", "success", "succeeded"].includes(status), detail: status },
    { name: "no task issues", passed: issues.length === 0, detail: issues.length ? `${issues.length} issue(s) require review` : "none" },
    { name: "figures available", passed: figurePaths.length > 0, detail: figurePaths.length ? `${figurePaths.length} figure(s)` : "no figures attached" },
    ...(params.beforeExecutionId ? [{ name: "execution comparison", passed: comparison !== undefined, detail: comparison === undefined ? "comparison unavailable" : `${changedParameters ?? 0} changed parameter(s)` }] : []),
  ];
  const passed = gates[0].passed && gates[1].passed;
  const comparisonGate = gates.find((gate) => gate.name === "execution comparison");
  const validationStatus: CalibrationValidation["status"] = !gates[0].passed ? "failed" : issues.length > 0 || !gates[2].passed || comparisonGate?.passed === false ? "needs_review" : "passed";
  const next = validationStatus === "passed"
    ? "Inspect candidates and ask for explicit confirmation before commit/apply. Preserve evidence in the target Forum thread when appropriate."
    : validationStatus === "failed"
      ? "Stop the recovery sequence; inspect the task message and figures before another operational action."
      : "Review the listed issues/figures before treating this result as authoritative.";
  return {
    context: { profile: params.profile ?? currentContext.profile, chipId: firstString(task, ["chip_id", "chipId"]) ?? currentContext.chipId, webBaseUrl: qdashWebBaseUrl(client) },
    taskId: params.taskId,
    task,
    status: validationStatus,
    gates,
    figurePaths,
    issues,
    comparison,
    next,
    links: qdashObjectLinks(client, task),
  };
}

function calibrationValidationLines(validation: CalibrationValidation, color = false): string[] {
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const statusColor = validation.status === "passed" ? "32" : validation.status === "failed" ? "31" : "33";
  const statusText = color ? ansi(statusColor, validation.status) : validation.status;
  return boxed(`QDash Calibration Validation ${shortId(validation.taskId, 16)}`, [
    `${muted("status")} ${statusText}`,
    `${muted("task")} ${firstString(validation.task, ["task_name", "name"]) ?? "unknown"}`,
    "",
    accent("Gates"),
    ...validation.gates.map((gate) => `${gate.passed ? "✓" : "✗"} ${gate.name}: ${gate.detail}`),
    "",
    `${accent("next")} ${validation.next}`,
    ...(validation.figurePaths.length ? ["", `${muted("figures")} ${validation.figurePaths.length} (use qdash_get_task_figures)`] : []),
    ...(validation.comparison ? [`${muted("comparison")} ${firstNumber(validation.comparison as Record<string, unknown>, ["unchanged_count"]) ?? 0} unchanged parameter(s)`] : []),
    ...(validation.links.task_result ? [`${muted("task url")} ${validation.links.task_result}`] : []),
  ], color);
}

function recommendationLines(recommendations: RecommendedNextAction[], color = false): string[] {
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const mark = (status: string) => ["done", "ok"].includes(status) ? "✓" : ["stop", "human", "review"].includes(status) ? "✗" : "→";
  return boxed("QDash Next Action", recommendations.length > 0 ? recommendations.flatMap((item) => [
    `${mark(item.status)} ${accent(item.target)} ${muted(`[${item.status}]`)} ${item.recommendation}`,
    `    ${muted("reason")} ${item.reason}`,
    ...(item.links.task_result ? [`    ${muted("task")} ${item.links.task_result}`] : []),
    ...(item.links.execution ? [`    ${muted("exec")} ${item.links.execution}`] : []),
  ]) : [muted("no recent calibration target found")], color);
}

type DashboardInsight = {
  target: string;
  severity: "critical" | "warning" | "info";
  title: string;
  evidence: string[];
  suggestion: string;
  links: Record<string, string[]>;
};

type DashboardInsightsResult = {
  context: { profile?: string; chipId: string; webBaseUrl: string };
  insights: DashboardInsight[];
};

function targetFromText(text: string): string | undefined {
  const coupling = text.match(/Q?0*(\d{1,3})\s*[-–]\s*Q?0*(\d{1,3})/i);
  if (coupling) return `c${Number(coupling[1])}-${Number(coupling[2])}`;
  const qubit = text.match(/\bQ0*(\d{1,3})\b/i);
  return qubit ? `q${Number(qubit[1])}` : undefined;
}

function addEvidence(map: Map<string, DashboardInsight>, target: string, severity: DashboardInsight["severity"], title: string, evidence: string, suggestion: string, links: Record<string, string> = {}) {
  const existing = map.get(target);
  const rank = { info: 0, warning: 1, critical: 2 } as const;
  if (!existing) {
    map.set(target, { target, severity, title, evidence: [evidence], suggestion, links: Object.fromEntries(Object.entries(links).map(([key, value]) => [key, [value]])) });
    return;
  }
  if (rank[severity] > rank[existing.severity]) existing.severity = severity;
  if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
  for (const [key, value] of Object.entries(links)) existing.links[key] = [...(existing.links[key] ?? []), value];
}

function addMetricInsights(map: Map<string, DashboardInsight>, metrics: unknown, client: QDashClient) {
  if (!metrics || typeof metrics !== "object") return;
  const qubitMetrics = (metrics as Record<string, unknown>).qubit_metrics;
  if (!qubitMetrics || typeof qubitMetrics !== "object") return;
  const metricObject = qubitMetrics as Record<string, unknown>;
  const checks: Array<{ name: string; threshold: number; direction: "below"; label: string }> = [
    { name: "t1", threshold: 5, direction: "below", label: "low T1" },
    { name: "t2_echo", threshold: 2, direction: "below", label: "low T2 echo" },
    { name: "average_readout_fidelity", threshold: 0.8, direction: "below", label: "low readout fidelity" },
    { name: "average_gate_fidelity", threshold: 0.98, direction: "below", label: "low 1Q gate fidelity" },
  ];
  for (const check of checks) {
    const values = metricObject[check.name];
    if (!values || typeof values !== "object") continue;
    for (const [qid, item] of Object.entries(values as Record<string, unknown>)) {
      if (!item || typeof item !== "object") continue;
      const value = (item as Record<string, unknown>).value;
      if (typeof value !== "number" || !Number.isFinite(value) || value >= check.threshold) continue;
      const links = qdashObjectLinks(client, item as Record<string, unknown>);
      addEvidence(map, `q${qid}`, check.name === "t1" || check.name === "t2_echo" ? "warning" : "info", `${check.label} on q${qid}`, `${check.name}=${formatNumber(value)} below ${check.threshold}`, `Inspect ${check.name} history and related failed tasks/forum notes.`, links);
    }
  }
}

async function buildDashboardInsights(params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; limit?: number; withinHours?: number }): Promise<DashboardInsightsResult> {
  params = applyQDashContext(params);
  const client = await makeClient(params);
  const chipId = await defaultChipId(client, params.chipId);
  const limit = params.limit ?? 30;
  const end = new Date();
  const start = new Date(end.getTime() - (params.withinHours ?? 168) * 3600_000);
  const [forums, issues, failed, metrics, aiInsights] = await Promise.allSettled([
    client.listForumPosts({ chipId, status: "open", limit }),
    rawGet(client, "/issues", { is_closed: false, limit }),
    rawGet(client, "/task-results", { chip_id: chipId, status: "failed", start_from: start.toISOString(), start_to: end.toISOString(), limit }),
    client.getChipMetrics(chipId),
    rawGet(client, `/chips/${pathPart(chipId)}/ai-insights`, { latest_only: true, start_at: start.toISOString(), end_at: end.toISOString() }),
  ]);
  const value = <T>(result: PromiseSettledResult<T>): T | undefined => result.status === "fulfilled" ? result.value : undefined;
  const insightMap = new Map<string, DashboardInsight>();

  for (const post of forumPostsFromPayload(value(forums))) {
    const targetType = firstString(post, ["target_type"]);
    const targetId = firstString(post, ["target_id", "qid"]);
    const title = forumPostTitle(post);
    const target = targetId ? (targetType === "coupling" ? `c${targetId}` : `q${targetId}`) : targetFromText(title);
    if (!target) continue;
    const lower = title.toLowerCase();
    const severity: DashboardInsight["severity"] = /tls|死|衝突|leak|リーク|不安定|見えない/.test(lower) ? "warning" : "info";
    addEvidence(insightMap, target, severity, title, `forum: ${title}`, "Open forum context should be reviewed before calibration changes.", qdashObjectLinks(client, post));
  }

  for (const issue of arrayFromPayload(value(issues)).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")) {
    const title = firstString(issue, ["title", "summary"]) ?? "open issue";
    const target = targetFromText(title) ?? firstString(issue, ["qid"]);
    if (!target) continue;
    addEvidence(insightMap, target.startsWith("q") || target.startsWith("c") ? target : `q${target}`, "warning", title, `open issue: ${title}`, "Resolve or account for the open issue before trusting metrics.", qdashObjectLinks(client, issue));
  }

  for (const task of arrayFromPayload(value(failed)).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")) {
    const target = calibrationTarget(task);
    const taskName = firstString(task, ["task_name", "name"]) ?? "task";
    const message = firstString(task, ["message"]) ?? "failed";
    addEvidence(insightMap, target, "warning", `${taskName} failed on ${target}`, `failed ${taskName}: ${message}`, "Inspect the failed task figures and recent history before continuing calibration.", qdashObjectLinks(client, task));
  }

  addMetricInsights(insightMap, value(metrics), client);

  const aiPayload = value(aiInsights);
  for (const item of arrayFromPayload(aiPayload).filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")) {
    const title = firstString(item, ["title", "summary"]) ?? "QDash AI insight";
    const severityValue = firstString(item, ["severity"])?.toLowerCase();
    const severity: DashboardInsight["severity"] = severityValue === "critical" ? "critical" : severityValue === "warning" ? "warning" : "info";
    const targets = Array.isArray(item.affected_targets) ? item.affected_targets.filter((target): target is string => typeof target === "string") : [];
    for (const rawTarget of targets) {
      const target = rawTarget.match(/^Q/i) ? `q${rawTarget.replace(/^Q0*/i, "")}` : rawTarget.match(/^C/i) ? `c${rawTarget.slice(1)}` : targetFromText(rawTarget);
      if (!target) continue;
      const evidence = firstString(item, ["recommended_action", "primary_reason"]) ?? `QDash AI insight: ${title}`;
      addEvidence(insightMap, target, severity, title, evidence, firstString(item, ["recommended_action"]) ?? "Review the QDash AI insight and supporting task evidence.");
    }
  }

  const insights = [...insightMap.values()].sort((a, b) => {
    const rank = { critical: 2, warning: 1, info: 0 } as const;
    return rank[b.severity] - rank[a.severity] || b.evidence.length - a.evidence.length;
  }).slice(0, limit);
  return { context: { profile: params.profile ?? currentContext.profile, chipId, webBaseUrl: qdashWebBaseUrl(client) }, insights };
}

function dashboardInsightLines(result: DashboardInsightsResult, color = false): string[] {
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const sev = (severity: string) => severity === "critical" ? "‼" : severity === "warning" ? "!" : "i";
  const body = [
    `${muted("profile")} ${accent(result.context.profile ?? "env/default")}  ${muted("chip")} ${accent(result.context.chipId)}`,
    `${muted("url")} ${result.context.webBaseUrl}`,
    "",
    ...(result.insights.length > 0 ? result.insights.flatMap((insight) => [
      `${sev(insight.severity)} ${accent(insight.target)} ${muted(`[${insight.severity}]`)} ${insight.title}`,
      ...insight.evidence.slice(0, 4).map((line) => `    - ${line}`),
      `    ${muted("suggest")} ${insight.suggestion}`,
      ...Object.entries(insight.links).flatMap(([kind, urls]) => urls.slice(0, 2).map((url) => `    ${muted(kind)} ${url}`)),
    ]) : [muted("no insights from current dashboard/forum/metrics data")]),
  ];
  return boxed("QDash Dashboard Insights", body, color);
}

type ForumEvidenceReplyParams = {
  parentPostId: string;
  taskId: string;
  interpretation: string;
  title?: string;
  includeFigures?: boolean;
  maxFigures?: number;
  includeHistory?: boolean;
  historyLimit?: number;
};

function filenameFromFigurePath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "figure.png";
}

function figureApiUrl(path: string): string {
  return `/api/executions/figure?path=${encodeURIComponent(path)}`;
}

function taskFigurePaths(task: Record<string, unknown>, maxFigures: number): string[] {
  const paths = task.figure_path;
  return Array.isArray(paths) ? paths.filter((item): item is string => typeof item === "string").slice(0, maxFigures) : [];
}

async function buildForumEvidenceReply(client: QDashClient, params: ForumEvidenceReplyParams) {
  const [parent, task] = await Promise.all([
    client.getForumPost(params.parentPostId) as unknown as Promise<Record<string, unknown>>,
    client.getTaskResult(params.taskId) as unknown as Promise<Record<string, unknown>>,
  ]);
  const taskName = firstString(task, ["task_name", "taskName"]) ?? "task";
  const qid = firstString(task, ["qid"]);
  const couplingId = firstString(task, ["coupling_id", "couplingId"]);
  const target = couplingId ? `coupling ${couplingId}` : qid ? `Q${qid}` : "target";
  const executionId = firstString(task, ["execution_id", "executionId"]);
  const message = firstString(task, ["message"]) ?? "";
  const chipId = firstString(task, ["chip_id", "chipId"]) ?? firstString(parent, ["chip_id", "chipId"]);
  const category = firstString(parent, ["category"]) ?? (couplingId ? "coupling" : "qubit");
  const targetType = firstString(parent, ["target_type", "targetType"]) ?? (couplingId ? "coupling" : qid ? "qubit" : undefined);
  const targetId = firstString(parent, ["target_id", "targetId"]) ?? couplingId ?? qid;
  const title = params.title ?? `${new Date().toISOString().slice(0, 10)} 追加観測: ${target} ${taskName}`;
  const taskUrl = qdashWebUrl(client, `/task-results/${encodeURIComponent(params.taskId)}`);
  const executionUrl = executionId ? qdashWebUrl(client, `/executions/${encodeURIComponent(executionId)}`) : undefined;
  const figures = params.includeFigures === false ? [] : taskFigurePaths(task, params.maxFigures ?? 2);
  const figureMarkdown = figures.map((path) => `![${filenameFromFigurePath(path)}](${figureApiUrl(path)})`).join("\n\n");
  const history = params.includeHistory === false ? [] : arrayFromPayload(await client.listTaskResults({
    chipId,
    taskName,
    qid,
    couplingId,
    limit: params.historyLimit ?? 5,
  })).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const historyLines = history
    .filter((item) => firstString(item, ["task_id", "taskId"]) !== params.taskId)
    .slice(0, Math.max(0, (params.historyLimit ?? 5) - 1))
    .map((item) => {
      const historyTaskId = firstString(item, ["task_id", "taskId"]);
      const status = firstString(item, ["status"]) ?? "unknown";
      const start = firstString(item, ["start_at", "startAt"])?.slice(0, 16) ?? "time unknown";
      const msg = firstString(item, ["message"]);
      return historyTaskId ? `- ${start} ${status}: [${historyTaskId}](${qdashWebUrl(client, `/task-results/${encodeURIComponent(historyTaskId)}`)})${msg ? ` — ${msg}` : ""}` : undefined;
    }).filter((line): line is string => Boolean(line));
  const content = [
    `## ${title}`,
    "",
    `${target} の \`${taskName}\` から evidence を追加します。`,
    "",
    `- [task](${taskUrl})`,
    ...(executionUrl ? [`- [execution](${executionUrl})`] : []),
    ...(message ? [`- message: \`${message}\``] : []),
    ...(figures.length > 0 ? ["", figureMarkdown] : []),
    ...(historyLines.length > 0 ? ["", `### Recent ${taskName} history`, "", ...historyLines] : []),
    "",
    params.interpretation,
    "",
    "— 🤖 by pi-qdash",
  ].join("\n");
  // Keep content_blocks empty so QDash renders the markdown `content` directly.
  // The current forum UI reliably renders markdown links and images, while BlockNote
  // link inline objects can appear blank in some deployed versions.
  const request = {
    category,
    title: null,
    content,
    content_blocks: [],
    parent_id: params.parentPostId,
    chip_id: chipId,
    target_type: targetType,
    target_id: targetId,
    status: firstString(parent, ["status"]) ?? "open",
  };
  return { request, preview: content, parent, task, figures };
}

function forumPostsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  if (payload && typeof payload === "object") {
    const object = payload as Record<string, unknown>;
    for (const key of ["posts", "items", "results", "data"]) {
      if (Array.isArray(object[key])) return object[key].filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

function forumPostId(post: Record<string, unknown>): string {
  return firstString(post, ["post_id", "id", "forum_post_id"]) ?? "unknown";
}

function forumPostTitle(post: Record<string, unknown>): string {
  return firstString(post, ["title", "subject", "summary"]) ?? firstString(post, ["content", "body", "text"])?.slice(0, 60) ?? "(untitled)";
}

function firstNumber(object: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function forumPostLine(post: Record<string, unknown>): string {
  const number = firstNumber(post, ["number"]);
  const id = shortId(forumPostId(post), 10);
  const title = forumPostTitle(post);
  const status = firstString(post, ["status"]);
  const category = firstString(post, ["category"]);
  const targetType = firstString(post, ["target_type"]);
  const target = firstString(post, ["target_id", "chip_id", "task_id", "qid"]);
  const replies = firstNumber(post, ["reply_count"]);
  const assignee = firstString(post, ["assignee_username", "username"]);
  return [
    "•",
    number ? `#${number}` : id,
    title,
    category ? `[${category}]` : undefined,
    status ? `[${status}]` : undefined,
    target ? `(${targetType ? `${targetType}:` : ""}${target})` : undefined,
    replies && replies > 0 ? `↩${replies}` : undefined,
    assignee ? `@${assignee}` : undefined,
  ].filter(Boolean).join(" ");
}

function inlineContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const object = item as Record<string, unknown>;
    if (typeof object.text === "string") return object.text;
    if (object.type === "link") return inlineContentText(object.content);
    return "";
  }).join("");
}

function forumBlockLines(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) return [];
  const lines: string[] = [];
  for (const item of blocks) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    const type = firstString(block, ["type"]) ?? "block";
    const props = block.props && typeof block.props === "object" ? block.props as Record<string, unknown> : {};
    const text = inlineContentText(block.content).trimEnd();
    if (type === "heading") {
      const level = firstNumber(props, ["level"]) ?? 2;
      lines.push(`${"#".repeat(Math.max(1, Math.min(6, level)))} ${text}`.trimEnd());
    } else if (type === "image") {
      const name = firstString(props, ["name", "caption"]) ?? "image";
      const url = firstString(props, ["url"]);
      lines.push(`🖼 ${name}${url ? `  ${url}` : ""}`);
    } else if (type === "bulletListItem") {
      lines.push(`- ${text}`);
    } else if (type === "numberedListItem") {
      lines.push(`1. ${text}`);
    } else if (text) {
      lines.push(...text.split("\n"));
    }
    const childLines = forumBlockLines(block.children);
    if (childLines.length > 0) lines.push(...childLines.map((line) => `  ${line}`));
  }
  return lines;
}

function forumContentLines(object: Record<string, unknown>): string[] {
  const blockLines = forumBlockLines(object.content_blocks);
  if (blockLines.length > 0) return blockLines;
  const content = firstString(object, ["content", "body", "text", "message", "description"]);
  return content ? content.split("\n") : ["(no content)"];
}

function forumListLines(payload: unknown, title = "QDash Forum", color = false): string[] {
  const posts = forumPostsFromPayload(payload);
  const total = payloadTotal(payload);
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const dim = (text: string) => color ? ansi("2", text) : text;
  return boxed(title, [
    `posts ${accent(`${posts.length}/${total}`)}`,
    "",
    ...(posts.length > 0 ? posts.map((post) => `  ${forumPostLine(post)}`) : [`  ${dim("none")}`]),
  ], color);
}

function forumDetailBodyLines(post: unknown, color = false): string[] {
  const object = post && typeof post === "object" ? post as Record<string, unknown> : {};
  const accent = (text: string) => color ? ansi("1;36", text) : text;
  const muted = (text: string) => color ? ansi("90", text) : text;
  const labels = stringList(object.labels);
  const replyCount = firstNumber(object, ["reply_count"]);
  const meta = [
    firstString(object, ["category"]) ? `${muted("category")} ${firstString(object, ["category"])}` : undefined,
    firstString(object, ["status"]) ? `${muted("status")} ${firstString(object, ["status"])}` : undefined,
    firstString(object, ["target_type"]) || firstString(object, ["target_id"]) ? `${muted("target")} ${[firstString(object, ["target_type"]), firstString(object, ["target_id"])].filter(Boolean).join(":")}` : undefined,
    firstString(object, ["chip_id"]) ? `${muted("chip")} ${firstString(object, ["chip_id"])}` : undefined,
    replyCount !== undefined ? `${muted("replies")} ${replyCount}` : undefined,
  ].filter((line): line is string => typeof line === "string");
  return [
    `${muted("id")} ${accent(forumPostId(object))}${firstNumber(object, ["number"]) ? `  ${muted("#")} ${firstNumber(object, ["number"])}` : ""}`,
    `${muted("title")} ${forumPostTitle(object)}`,
    `${muted("author")} ${firstString(object, ["username", "user_id"]) ?? "unknown"}${firstString(object, ["assignee_username"]) ? `  ${muted("assignee")} ${firstString(object, ["assignee_username"])}` : ""}`,
    meta.join("  "),
    labels.length > 0 ? `${muted("labels")} ${labels.map((label) => `#${label}`).join(" ")}` : undefined,
    firstString(object, ["created_at"]) ? `${muted("created")} ${firstString(object, ["created_at"])}${firstString(object, ["updated_at"]) ? `  ${muted("updated")} ${firstString(object, ["updated_at"])}` : ""}` : undefined,
    "",
    ...forumContentLines(object).map((line) => `  ${line}`),
  ].filter((line): line is string => typeof line === "string");
}

function forumDetailLines(post: unknown, title = "QDash Forum Post", color = false): string[] {
  return boxed(title, forumDetailBodyLines(post, color), color);
}

function wrapPlainLine(line: string, width: number): string[] {
  if (width <= 0 || visibleWidth(line) <= width) return [line];
  const output: string[] = [];
  let rest = line;
  while (visibleWidth(rest) > width) {
    let slice = "";
    for (const char of rest) {
      if (visibleWidth(slice + char) > width) break;
      slice += char;
    }
    output.push(slice);
    rest = rest.slice(slice.length);
  }
  if (rest.length > 0) output.push(rest);
  return output;
}

function boxLinesToWidth(title: string, body: string[], width: number, theme?: Theme): string[] {
  const contentWidth = Math.max(24, Math.min(100, width - 4));
  const border = (text: string) => theme ? theme.fg("borderMuted", text) : text;
  const titleText = ` ${title} `;
  const top = `${border("╭")}${theme ? theme.fg("accent", theme.bold(titleText)) : titleText}${border("─".repeat(Math.max(0, contentWidth + 2 - visibleWidth(titleText))))}${border("╮")}`;
  const bottom = border(`╰${"─".repeat(contentWidth + 2)}╯`);
  const rows = body.flatMap((line) => wrapPlainLine(line, contentWidth));
  return [
    top,
    ...rows.map((line) => `${border("│")} ${padAnsi(truncateDisplay(line, contentWidth), contentWidth)} ${border("│")}`),
    bottom,
  ];
}

function textComponent(lines: string[], _theme: Theme, wrap = false) {
  return {
    render(width: number) {
      if (!wrap) return lines.map((line) => truncateToWidth(line, width));
      return lines.flatMap((line) => wrapPlainLine(line, width));
    },
    invalidate() {},
  };
}

function forumDetailComponent(post: unknown, theme: Theme) {
  return {
    render(width: number) {
      return boxLinesToWidth("QDash Forum Post", forumDetailBodyLines(post), width, theme);
    },
    invalidate() {},
  };
}

type TimeseriesPoint = {
  series: string;
  value: number;
  at?: string;
  unit?: string;
  taskId?: string;
  executionId?: string;
};

function timeseriesPoints(payload: unknown): TimeseriesPoint[] {
  const points: TimeseriesPoint[] = [];
  const addPoint = (series: string, item: unknown) => {
    if (!item || typeof item !== "object") return;
    const object = item as Record<string, unknown>;
    const value = object.value;
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    points.push({
      series,
      value,
      at: firstString(object, ["calibrated_at", "timestamp", "created_at", "start_at"]),
      unit: firstString(object, ["unit"]),
      taskId: firstString(object, ["task_id"]),
      executionId: firstString(object, ["execution_id"]),
    });
  };
  const visit = (value: unknown, series = "series") => {
    if (Array.isArray(value)) {
      for (const item of value) addPoint(series, item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if ("value" in object) {
      addPoint(series, object);
      return;
    }
    for (const [key, nested] of Object.entries(object)) visit(nested, key);
  };
  if (payload && typeof payload === "object" && "data" in payload) visit((payload as Record<string, unknown>).data);
  else visit(payload);
  return points.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000 || (abs > 0 && abs < 0.001)) return value.toExponential(2);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 10) return value.toFixed(3);
  return value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function compactDate(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function samplePoints(points: TimeseriesPoint[], width: number): TimeseriesPoint[] {
  if (points.length <= width) return points;
  const sampled: TimeseriesPoint[] = [];
  for (let i = 0; i < width; i++) sampled.push(points[Math.round(i * (points.length - 1) / (width - 1))]);
  return sampled;
}

function plotSeriesLines(points: TimeseriesPoint[], options: { title: string; height?: number; width?: number; color?: boolean }): string[] {
  const height = Math.max(3, Math.min(20, options.height ?? 8));
  const plotWidth = Math.max(8, Math.min(100, options.width ?? 60));
  const accent = (text: string) => options.color ? ansi("1;36", text) : text;
  const muted = (text: string) => options.color ? ansi("90", text) : text;
  if (points.length === 0) return boxed(options.title, [muted("no numeric data")], options.color);

  const sampled = samplePoints(points, plotWidth);
  const values = sampled.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const grid = Array.from({ length: height }, () => Array.from({ length: sampled.length }, () => " "));
  sampled.forEach((point, col) => {
    const row = height - 1 - Math.round((point.value - min) / span * (height - 1));
    grid[Math.max(0, Math.min(height - 1, row))][col] = "●";
  });
  const yLabelWidth = Math.max(formatNumber(max).length, formatNumber(min).length, 6);
  const rows = grid.map((row, index) => {
    const value = max - (span * index / (height - 1));
    return `${formatNumber(value).padStart(yLabelWidth)} ┤${row.join("")}`;
  });
  const unit = points.find((point) => point.unit)?.unit;
  const first = points[0];
  const last = points[points.length - 1];
  const body = [
    `${muted("series")} ${accent([...new Set(points.map((point) => point.series))].join(", "))}${unit ? `  ${muted("unit")} ${unit}` : ""}`,
    `${muted("count")} ${points.length}  ${muted("min")} ${formatNumber(Math.min(...points.map((point) => point.value)))}  ${muted("max")} ${formatNumber(Math.max(...points.map((point) => point.value)))}  ${muted("last")} ${formatNumber(last.value)}`,
    `${muted("range")} ${compactDate(first.at)} → ${compactDate(last.at)}`,
    "",
    ...rows,
    `${" ".repeat(yLabelWidth)} └${"─".repeat(sampled.length)}`,
  ];
  return boxed(options.title, body, options.color);
}

function timeseriesPlotComponent(data: unknown, title: string, theme: Theme) {
  return {
    render(width: number) {
      const points = timeseriesPoints(data);
      return plotSeriesLines(points, { title, width: Math.max(8, width - 16) }).map((line) => truncateToWidth(line, width));
    },
    invalidate() {},
  };
}

function mediaTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function fetchFigureDetails(client: QDashClient, path: string): Promise<FigureDetails> {
  const file = await client.getExecutionFigure(path);
  const bytes = Buffer.from(file.data);
  const mediaType = file.mediaType || mediaTypeForPath(path);
  const details: FigureDetails = {
    tool: "qdash_get_figure",
    path,
    mediaType,
    sizeBytes: bytes.byteLength,
  };
  if (mediaType.startsWith("image/")) details.base64 = bytes.toString("base64");
  else details.text = bytes.toString("utf8");
  return details;
}

function figureResultText(details: FigureDetails): string {
  const lines = boxed("QDash Figure", [
    `path ${details.path}`,
    `type ${details.mediaType}`,
    `size ${details.sizeBytes} bytes`,
    ...(details.taskId ? [`task ${details.taskId}`] : []),
    ...(details.figurePaths?.length ? [`figures ${details.figurePaths.length}`] : []),
    ...(details.jsonFigurePaths?.length ? [`json figures ${details.jsonFigurePaths.length}`] : []),
    ...(details.text ? ["", ...details.text.split("\n").slice(0, 12).map((line) => `  ${line}`)] : []),
  ]);
  return lines.join("\n");
}

function figureComponent(details: FigureDetails, theme: Theme) {
  if (details.base64 && details.mediaType.startsWith("image/")) {
    return new Image(details.base64, details.mediaType, { fallbackColor: (text: string) => theme.fg("dim", text) }, { maxWidthCells: 90, maxHeightCells: 30 });
  }
  return textComponent(figureResultText(details).split("\n"), theme);
}

async function executeQuery(params: QDashQueryParams) {
  params = applyQDashContext(params);
  const client = await makeClient(params);
  switch (params.action) {
    case "chips": return client.listChips();
    case "default_chip": return client.getDefaultChip();
    case "metrics_config": return client.getMetricsConfig();
    case "chip_metrics": return client.getChipMetrics(await defaultChipId(client, params.chipId));
    case "chip_qubits": return client.listChipQubits(await defaultChipId(client, params.chipId), { limit: params.limit, offset: params.offset });
    case "chip_qubit": return client.getChipQubit(await defaultChipId(client, params.chipId), requireValue(params.qid, "qid"));
    case "chip_couplings": return client.listChipCouplings(await defaultChipId(client, params.chipId), { limit: params.limit, offset: params.offset });
    case "chip_coupling": return client.getChipCoupling(await defaultChipId(client, params.chipId), requireValue(params.couplingId, "couplingId"));
    case "cryostats": return rawGet(client, "/cryostats");
    case "cryostat": return rawGet(client, `/cryostats/${pathPart(requireValue(params.cryoId, "cryoId"))}`);
    case "cooldowns": return rawGet(client, "/cooldowns", { cryo_id: params.cryoId, chip_id: params.chipId });
    case "cooldown": return rawGet(client, `/cooldowns/${pathPart(requireValue(params.cooldownId, "cooldownId"))}`);
    case "cooldown_wiring_events": return rawGet(client, `/cooldowns/${pathPart(requireValue(params.cooldownId, "cooldownId"))}/wiring-events`, { limit: params.limit, skip: params.skip });
    case "timeseries": return client.getTaskResultsTimeseries({ chipId: await defaultChipId(client, params.chipId), parameter: requireValue(params.parameter, "parameter"), tag: params.tag, qid: params.qid, startAt: requireValue(params.startAt, "startAt"), endAt: requireValue(params.endAt, "endAt") });
    case "task_results": return rawGet(client, "/task-results", { chip_id: params.chipId, task_name: params.taskName, qid: params.qid, coupling_id: params.couplingId, execution_id: params.executionId, username: params.username, status: params.status, start_from: params.startFrom ?? params.startAt, start_to: params.startTo ?? params.endAt, message_contains: params.messageContains, limit: params.limit, skip: params.skip });
    case "task_result": return client.getTaskResult(requireValue(params.taskId, "taskId"));
    case "task_note": return rawGet(client, `/task-results/${pathPart(requireValue(params.taskId, "taskId"))}/note`);
    case "task_result_issues": return rawGet(client, `/task-results/${pathPart(requireValue(params.taskId, "taskId"))}/issues`);
    case "qubit_latest": return rawGet(client, "/task-results/qubits/latest", { chip_id: await defaultChipId(client, params.chipId), task: requireValue(params.task ?? params.taskName, "task") });
    case "qubit_history": return rawGet(client, `/task-results/qubits/${pathPart(requireValue(params.qid, "qid"))}/history`, { chip_id: await defaultChipId(client, params.chipId), task: requireValue(params.task ?? params.taskName, "task"), date: requireValue(params.date, "date") });
    case "coupling_latest": return rawGet(client, "/task-results/couplings/latest", { chip_id: await defaultChipId(client, params.chipId), task: requireValue(params.task ?? params.taskName, "task") });
    case "coupling_history": return rawGet(client, `/task-results/couplings/${pathPart(requireValue(params.couplingId, "couplingId"))}/history`, { chip_id: await defaultChipId(client, params.chipId), task: requireValue(params.task ?? params.taskName, "task"), date: requireValue(params.date, "date") });
    case "tasks": return client.listTasks(params.backend);
    case "task_knowledge": return params.taskName ? client.getTaskKnowledge(params.taskName) : client.listTaskKnowledge();
    case "task_knowledge_markdown": return client.getTaskKnowledgeMarkdown(requireValue(params.taskName, "taskName"));
    case "projects": return client.listProjects();
    case "project": return client.getProject(requireValue(params.projectId, "projectId"));
    case "files_tree": return client.getFilesTree();
    case "file_content": return client.getFileContent(requireValue(params.path, "path"));
    case "git_status": return client.getGitStatus();
    case "issues": return rawGet(client, "/issues", { task_id: params.taskId, is_closed: params.isClosed, limit: params.limit, skip: params.skip });
    case "issue_knowledge": return rawGet(client, "/issue-knowledge", { status: params.status, task_name: params.taskName, limit: params.limit, skip: params.skip });
    case "flows": return client.listFlows();
    case "flow": return client.getFlow(requireValue(params.flowName, "flowName"));
    case "flow_templates": return client.listFlowTemplates();
    case "flow_template": return client.getFlowTemplate(requireValue(params.templateId, "templateId"));
    case "flow_helper_files": return rawGet(client, "/flows/helpers");
    case "flow_helper_file": return rawGet(client, `/flows/helpers/${pathPart(requireValue(params.filename, "filename"))}`);
    case "executions": return rawGet(client, "/executions", { chip_id: params.chipId, flow_name: params.flowName, status: params.status, skip: params.skip, limit: params.limit });
    case "execution": return client.getExecution(requireValue(params.executionId, "executionId"));
    case "ai_reviews": return rawGet(client, "/task-results/ai-review", { chip_id: params.chipId, task_name: params.taskName, status: params.status, decision: params.decision, latest_only: params.latestOnly, skip: params.skip, limit: params.limit });
    case "ai_review_runs": return rawGet(client, "/task-results/ai-review/runs", { chip_id: params.chipId, task_name: params.taskName, skip: params.skip, limit: params.limit });
    case "ai_review_run": return rawGet(client, `/task-results/ai-review/runs/${pathPart(requireValue(params.reviewRunId, "reviewRunId"))}`);
    case "forum_posts": return client.listForumPosts({ status: params.status, chipId: params.chipId, limit: params.limit, skip: params.skip });
    case "provenance_stats": return client.getProvenanceStats();
    case "provenance_history": return rawGet(client, "/provenance/history", { parameter_name: params.parameterName ?? params.parameter, qid: params.qid, limit: params.limit });
    case "provenance_changes": return rawGet(client, "/provenance/changes", { parameter_names: params.parameterName ?? params.parameter, within_hours: params.withinHours, limit: params.limit });
    case "provenance_lineage": return client.getProvenanceLineage(requireValue(params.entityId, "entityId"));
    case "provenance_impact": return client.getProvenanceImpact(requireValue(params.entityId, "entityId"));
  }
}

export default function qdashExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!WRITE_TOOL_NAMES.has(event.toolName)) return;
    const input = event.input as { confirmWrite?: boolean };
    if (input.confirmWrite === true) return;

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `${event.toolName} is a QDash write operation and requires confirmWrite: true in non-interactive mode.`,
      };
    }

    const ok = await ctx.ui.confirm(
      "Approve QDash write operation?",
      `${event.toolName} will create or modify data in QDash. Continue?`,
    );
    if (!ok) return { block: true, reason: "QDash write operation rejected by user" };
    input.confirmWrite = true;
  });

  pi.registerTool({
    name: "qdash_config_info",
    label: "QDash Config Info",
    description: "Show non-secret QDash client configuration and available local profiles.",
    promptSnippet: "Inspect QDash profile availability and non-secret connection settings",
    promptGuidelines: ["Use qdash_config_info before QDash queries when profile or configuration is unclear. Never expose QDash secrets."],
    parameters: Type.Object(connectionParams),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean }) {
      const profiles = configProfiles(params.configPath);
      try {
        const client = await makeClient(params);
        return toToolResult({ profiles, active: safeConfig(client, shouldUseEnv(params) ? "env" : `profile:${params.profile ?? "default"}`) });
      } catch (error) {
        return toToolResult({ profiles, error: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  pi.registerTool({
    name: "qdash_query",
    label: "QDash Query",
    description: "Run common read-only QDash queries via @oqtopus-team/qdash-client.",
    promptSnippet: "Query QDash chips, cryostats, cooldown wiring, metrics, tasks, files, flows, executions, projects, forum posts, and provenance",
    promptGuidelines: [
      "Prefer dedicated QDash tools such as qdash_list_chips, qdash_get_chip_metrics, qdash_list_task_results, qdash_list_issues, qdash_list_flows, and qdash_list_executions when they match the task.",
      "Use qdash_query for read-only QDash data access not covered by a dedicated tool, instead of curl or scraping the UI.",
      "Ask for confirmation before using operational or write APIs; qdash_query intentionally exposes read-only operations only.",
      "Never expose QDash tokens, passwords, or Cloudflare Access secrets.",
    ],
    parameters: querySchema,
    async execute(_toolCallId, params: QDashQueryParams) {
      const data = await executeQuery(params);
      const client = await makeClient(params);
      return toToolResult(withQDashLinks(client, data), { action: params.action, webBaseUrl: qdashWebBaseUrl(client) });
    },
  });

  const registerQueryTool = (tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet: string;
    action: QDashQueryParams["action"];
    parameters: ReturnType<typeof Type.Object>;
  }) => {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      promptGuidelines: [
        `Prefer ${tool.name} for this specific read-only QDash operation instead of qdash_query or qdash_raw_get.`,
        "Never expose QDash tokens, passwords, or Cloudflare Access secrets.",
      ],
      parameters: tool.parameters,
      async execute(_toolCallId, params: Omit<QDashQueryParams, "action">) {
        const data = await executeQuery({ ...params, action: tool.action });
        const client = await makeClient(params);
        return toToolResult(withQDashLinks(client, data), { action: tool.action, tool: tool.name, webBaseUrl: qdashWebBaseUrl(client) });
      },
    });
  };

  registerQueryTool({
    name: "qdash_list_chips",
    label: "QDash List Chips",
    description: "List QDash chips through qdash-client.",
    promptSnippet: "List QDash chips and their status",
    action: "chips",
    parameters: Type.Object(connectionParams),
  });

  registerQueryTool({
    name: "qdash_get_default_chip",
    label: "QDash Default Chip",
    description: "Get the active/default QDash chip.",
    promptSnippet: "Get the default active QDash chip",
    action: "default_chip",
    parameters: Type.Object(connectionParams),
  });

  registerQueryTool({
    name: "qdash_get_chip_metrics",
    label: "QDash Chip Metrics",
    description: "Get metrics for a chip. If chipId is omitted, the default chip is used.",
    promptSnippet: "Get QDash chip metrics for the default or specified chip",
    action: "chip_metrics",
    parameters: Type.Object({ ...connectionParams, ...chipScopedParams }),
  });

  registerQueryTool({
    name: "qdash_list_chip_qubits",
    label: "QDash List Chip Qubits",
    description: "List qubits for a chip. If chipId is omitted, the default chip is used.",
    promptSnippet: "List qubits for a QDash chip",
    action: "chip_qubits",
    parameters: Type.Object({ ...connectionParams, ...chipScopedParams, ...paginationParams }),
  });

  registerQueryTool({
    name: "qdash_list_chip_couplings",
    label: "QDash List Chip Couplings",
    description: "List couplings for a chip. If chipId is omitted, the default chip is used.",
    promptSnippet: "List couplings for a QDash chip",
    action: "chip_couplings",
    parameters: Type.Object({ ...connectionParams, ...chipScopedParams, ...paginationParams }),
  });

  registerQueryTool({
    name: "qdash_list_cryostats",
    label: "QDash List Cryostats",
    description: "List cryostats available in QDash.",
    promptSnippet: "List QDash cryostats before inspecting cooldowns or wiring",
    action: "cryostats",
    parameters: Type.Object(connectionParams),
  });

  registerQueryTool({
    name: "qdash_list_cooldowns",
    label: "QDash List Cooldowns",
    description: "List QDash cooldowns, optionally filtered by cryostat or chip.",
    promptSnippet: "List cryostat cooldowns and identify the active or latest wiring context",
    action: "cooldowns",
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      cryoId: Type.Optional(Type.String()),
    }),
  });

  pi.registerTool({
    name: "qdash_get_cooldown_wiring",
    label: "QDash Cooldown Wiring",
    description: "Get cryostat/cooldown wiring. A cooldown can be selected explicitly, or the active/newest cooldown is resolved automatically from cryoId or the active/default chip.",
    promptSnippet: "Resolve the relevant cryostat cooldown and retrieve its human-readable wiring information",
    promptGuidelines: [
      "Prefer qdash_get_cooldown_wiring whenever the user asks about cryo, cryostat, cooldown, cabling, or wiring.",
      "Omit cooldownId to automatically select the active cooldown, falling back to the newest cooldown for the cryostat or chip.",
      "The markdown field is the compact human-readable wiring document. Request includeBlocks only when raw BlockNote structure or embedded content is needed.",
      "Use includeHistory when investigating when or why wiring changed.",
      "Set includeInsights when you want to naturally point out unusual attenuation totals and the affected qubits/MUXes; otherwise prefer qdash_wiring_insights for a focused summary.",
      "Never expose QDash tokens, passwords, or Cloudflare Access secrets.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String({ description: "Chip used to resolve its active/newest cooldown. Defaults to the current/default chip." })),
      cryoId: Type.Optional(Type.String({ description: "Cryostat used to resolve its active/newest cooldown." })),
      cooldownId: Type.Optional(Type.String({ description: "Explicit cooldown ID; takes precedence over chipId and cryoId." })),
      includeBlocks: Type.Optional(Type.Boolean({ description: "Include raw BlockNote wiring blocks. Defaults to false unless markdown is unavailable." })),
      includeHistory: Type.Optional(Type.Boolean({ description: "Include wiring checkpoint history." })),
      historyLimit: Type.Optional(Type.Number({ description: "Maximum wiring history entries; defaults to 20." })),
      includeInsights: Type.Optional(Type.Boolean({ description: "Analyze attenuation totals and highlight unusual control/readout ports. Defaults to false; use qdash_wiring_insights for a focused summary." })),
    }),
    async execute(_toolCallId, params: CooldownWiringParams) {
      const data = await resolveCooldownWiring(params);
      const client = await makeClient(params);
      return toToolResult(withQDashLinks(client, data), {
        tool: "qdash_get_cooldown_wiring",
        webBaseUrl: qdashWebBaseUrl(client),
      });
    },
  });

  pi.registerTool({
    name: "qdash_wiring_insights",
    label: "QDash Wiring Insights",
    description: "Analyze cooldown wiring markdown and summarize attenuation totals, unusual ports, and affected qubits/MUXes.",
    promptSnippet: "Highlight unusual QDash wiring attenuation totals and affected qubits/MUXes",
    promptGuidelines: [
      "Use qdash_wiring_insights when the user asks what is characteristic, unusual, different, or noteworthy in wiring attenuation.",
      "Report totals concisely, and translate control-port anomalies to qids when the MUX×4 mapping is available.",
      "This tool is read-only and does not change QDash wiring or calibration parameters.",
      "Never expose QDash tokens, passwords, or Cloudflare Access secrets.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String({ description: "Chip used to resolve its active/newest cooldown. Defaults to the current/default chip." })),
      cryoId: Type.Optional(Type.String({ description: "Cryostat used to resolve its active/newest cooldown." })),
      cooldownId: Type.Optional(Type.String({ description: "Explicit cooldown ID; takes precedence over chipId and cryoId." })),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: WiringInsightParams) {
      const data = await resolveCooldownWiring({ ...params, includeBlocks: false, includeHistory: false, includeInsights: true });
      const insights = data.insights;
      const client = await makeClient(params);
      if (!insights) return toToolResult(withQDashLinks(client, data), { tool: "qdash_wiring_insights", webBaseUrl: qdashWebBaseUrl(client) });
      return toTextToolResult(wiringInsightLines(insights, params.color).join("\n"), withQDashLinks(client, data), {
        tool: "qdash_wiring_insights",
        webBaseUrl: qdashWebBaseUrl(client),
      });
    },
  });

  registerQueryTool({
    name: "qdash_list_cooldown_wiring_events",
    label: "QDash Cooldown Wiring History",
    description: "List wiring change checkpoints for a cooldown.",
    promptSnippet: "Inspect QDash cooldown wiring change history and snapshots",
    action: "cooldown_wiring_events",
    parameters: Type.Object({
      ...connectionParams,
      cooldownId: Type.String(),
      limit: Type.Optional(Type.Number()),
      skip: Type.Optional(Type.Number()),
    }),
  });

  registerQueryTool({
    name: "qdash_get_timeseries",
    label: "QDash Timeseries",
    description: "Get task-result timeseries for a parameter and time range.",
    promptSnippet: "Get QDash task-result timeseries for a parameter over a time range",
    action: "timeseries",
    parameters: Type.Object({
      ...connectionParams,
      ...chipScopedParams,
      parameter: Type.String(),
      startAt: Type.String({ description: "Start timestamp, preferably UTC ISO with Z." }),
      endAt: Type.String({ description: "End timestamp, preferably UTC ISO with Z." }),
      qid: Type.Optional(Type.String()),
      tag: Type.Optional(Type.String()),
    }),
  });

  pi.registerTool({
    name: "qdash_plot_timeseries",
    label: "QDash Plot Timeseries",
    description: "Render a compact TUI sparkline/plot for a task-result parameter timeseries.",
    promptSnippet: "Plot QDash task-result timeseries in the TUI",
    promptGuidelines: ["Use qdash_plot_timeseries when the user wants to visualize history, drift, trends, or analysis timeseries in the TUI."],
    parameters: Type.Object({
      ...connectionParams,
      ...chipScopedParams,
      parameter: Type.String(),
      startAt: Type.Optional(Type.String({ description: "Start timestamp, preferably UTC ISO with Z. Defaults to withinHours ago." })),
      endAt: Type.Optional(Type.String({ description: "End timestamp, preferably UTC ISO with Z. Defaults to now." })),
      withinHours: Type.Optional(Type.Number({ description: "Lookback window when startAt is omitted. Defaults to 168 hours." })),
      qid: Type.Optional(Type.String()),
      tag: Type.Optional(Type.String()),
      height: Type.Optional(Type.Number()),
      width: Type.Optional(Type.Number()),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; parameter: string; startAt?: string; endAt?: string; withinHours?: number; qid?: string; tag?: string; height?: number; width?: number; color?: boolean }) {
      const client = await makeClient(params);
      const endAt = params.endAt ?? new Date().toISOString();
      const startAt = params.startAt ?? new Date(Date.parse(endAt) - (params.withinHours ?? 168) * 3600_000).toISOString();
      const chipId = await defaultChipId(client, params.chipId);
      const data = await client.getTaskResultsTimeseries({ chipId, parameter: params.parameter, tag: params.tag, qid: params.qid, startAt, endAt });
      const title = `QDash Timeseries: ${params.parameter}${params.qid ? ` q${params.qid}` : ""}`;
      const text = plotSeriesLines(timeseriesPoints(data), { title, height: params.height, width: params.width, color: params.color }).join("\n");
      return toTextToolResult(text, data, { tool: "qdash_plot_timeseries", parameter: params.parameter, qid: params.qid, chipId, startAt, endAt });
    },
    renderResult(result, _options, theme) {
      const details = result.details as { data?: unknown; parameter?: string; qid?: string } | undefined;
      const title = `QDash Timeseries: ${details?.parameter ?? "parameter"}${details?.qid ? ` q${details.qid}` : ""}`;
      return timeseriesPlotComponent(details?.data, title, theme);
    },
  });

  registerQueryTool({
    name: "qdash_list_task_results",
    label: "QDash List Task Results",
    description: "List task results with common filters.",
    promptSnippet: "List QDash task results with filters such as chip, task, status, qubit, coupling, or time range",
    action: "task_results",
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      taskName: Type.Optional(Type.String()),
      qid: Type.Optional(Type.String()),
      couplingId: Type.Optional(Type.String()),
      executionId: Type.Optional(Type.String()),
      username: Type.Optional(Type.String()),
      status: Type.Optional(Type.String()),
      startAt: Type.Optional(Type.String()),
      endAt: Type.Optional(Type.String()),
      startFrom: Type.Optional(Type.String()),
      startTo: Type.Optional(Type.String()),
      messageContains: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      skip: Type.Optional(Type.Number()),
    }),
  });

  registerQueryTool({
    name: "qdash_get_task_result",
    label: "QDash Task Result",
    description: "Get a single task result by taskId.",
    promptSnippet: "Get a QDash task result by task ID",
    action: "task_result",
    parameters: Type.Object({ ...connectionParams, taskId: Type.String() }),
  });

  registerQueryTool({
    name: "qdash_list_issues",
    label: "QDash List Issues",
    description: "List QDash issues with optional task/closed filters.",
    promptSnippet: "List QDash issues",
    action: "issues",
    parameters: Type.Object({ ...connectionParams, taskId: Type.Optional(Type.String()), isClosed: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Number()), skip: Type.Optional(Type.Number()) }),
  });

  registerQueryTool({
    name: "qdash_list_flows",
    label: "QDash List Flows",
    description: "List QDash flows.",
    promptSnippet: "List QDash flows",
    action: "flows",
    parameters: Type.Object(connectionParams),
  });

  registerQueryTool({
    name: "qdash_get_flow",
    label: "QDash Get Flow",
    description: "Get a QDash flow by name.",
    promptSnippet: "Get a QDash flow definition by name",
    action: "flow",
    parameters: Type.Object({ ...connectionParams, flowName: Type.String() }),
  });

  registerQueryTool({
    name: "qdash_list_executions",
    label: "QDash List Executions",
    description: "List QDash executions with optional chip, flow, status, and pagination filters.",
    promptSnippet: "List QDash executions",
    action: "executions",
    parameters: Type.Object({ ...connectionParams, chipId: Type.Optional(Type.String()), flowName: Type.Optional(Type.String()), status: Type.Optional(Type.String()), limit: Type.Optional(Type.Number()), skip: Type.Optional(Type.Number()) }),
  });

  pi.registerTool({
    name: "qdash_wait_execution",
    label: "QDash Wait Execution",
    description: "Poll a QDash execution until it reaches a terminal state. This is read-only and does not start, cancel, or modify execution.",
    promptSnippet: "Wait for a QDash calibration execution to finish and inspect its final state",
    promptGuidelines: [
      "Use qdash_wait_execution after a confirmed calibration action when the user wants completion polling.",
      "After completion, use qdash_validate_calibration before committing or applying any candidates.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      executionId: Type.String(),
      timeoutSeconds: Type.Optional(Type.Number()),
      pollIntervalSeconds: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; executionId: string; timeoutSeconds?: number; pollIntervalSeconds?: number }) {
      const client = await makeClient(params);
      const data = await client.waitForExecution(params.executionId, { timeoutSeconds: params.timeoutSeconds, pollIntervalSeconds: params.pollIntervalSeconds });
      return toToolResult(withQDashLinks(client, data), { tool: "qdash_wait_execution", executionId: params.executionId, webBaseUrl: qdashWebBaseUrl(client) });
    },
  });

  pi.registerTool({
    name: "qdash_compare_executions",
    label: "QDash Compare Executions",
    description: "Compare calibration parameter values between two QDash executions. Read-only.",
    promptSnippet: "Compare QDash calibration parameters before and after an execution",
    promptGuidelines: [
      "Use qdash_compare_executions when validating the effect of a calibration execution.",
      "A parameter difference is evidence only; require explicit review before commit or apply.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      executionIdBefore: Type.String(),
      executionIdAfter: Type.String(),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; executionIdBefore: string; executionIdAfter: string; color?: boolean }) {
      const client = await makeClient(params);
      const data = await client.compareExecutions(params.executionIdBefore, params.executionIdAfter);
      const record = data as unknown as Record<string, unknown>;
      const changed = Array.isArray(record.changed_parameters) ? record.changed_parameters.length : 0;
      const added = Array.isArray(record.added_parameters) ? record.added_parameters.length : 0;
      const removed = Array.isArray(record.removed_parameters) ? record.removed_parameters.length : 0;
      const text = boxed("QDash Execution Comparison", [
        `before ${params.executionIdBefore}`,
        `after  ${params.executionIdAfter}`,
        "",
        `changed ${changed}  added ${added}  removed ${removed}`,
        `unchanged ${firstNumber(record, ["unchanged_count"]) ?? 0}`,
        "",
        "Read-only comparison. Review changed parameters and validation figures before committing or applying candidates.",
      ], params.color).join("\\n");
      return toTextToolResult(text, data, { tool: "qdash_compare_executions", webBaseUrl: qdashWebBaseUrl(client) });
    },
  });

  registerQueryTool({
    name: "qdash_get_execution",
    label: "QDash Get Execution",
    description: "Get a QDash execution by executionId.",
    promptSnippet: "Get QDash execution details by execution ID",
    action: "execution",
    parameters: Type.Object({ ...connectionParams, executionId: Type.String() }),
  });

  registerQueryTool({
    name: "qdash_list_ai_reviews",
    label: "QDash List AI Reviews",
    description: "List task-result AI reviews with optional filters.",
    promptSnippet: "List QDash task-result AI reviews",
    action: "ai_reviews",
    parameters: Type.Object({ ...connectionParams, chipId: Type.Optional(Type.String()), taskName: Type.Optional(Type.String()), status: Type.Optional(Type.String()), decision: Type.Optional(Type.String()), latestOnly: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Number()), skip: Type.Optional(Type.Number()) }),
  });

  pi.registerTool({
    name: "qdash_create_agent_session",
    label: "QDash Create Agent Session",
    description: "Create a QDash agent calibration session. This is a write operation and requires confirmation.",
    promptSnippet: "Create a QDash agent calibration session after explicit user confirmation",
    promptGuidelines: [
      "Use qdash_create_agent_session only after the user explicitly asks to start an agent calibration workflow.",
      "qdash_create_agent_session is a write operation; set confirmWrite only after user confirmation.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      ...chipScopedParams,
      policy: Type.Any({ description: "Agent session policy object accepted by QDash." }),
      expiresInSeconds: Type.Optional(Type.Number()),
      skillName: Type.Optional(Type.String()),
      skillVersion: Type.Optional(Type.String()),
      skillHash: Type.Optional(Type.String()),
      modelName: Type.Optional(Type.String()),
      confirmWrite: Type.Optional(Type.Boolean({ description: "Required for non-interactive execution. Set true only after explicit user confirmation." })),
    }),
    async execute(_toolCallId, params: ConfirmableParams & {
      profile?: string;
      configPath?: string;
      useEnv?: boolean;
      chipId?: string;
      policy: unknown;
      expiresInSeconds?: number;
      skillName?: string;
      skillVersion?: string;
      skillHash?: string;
      modelName?: string;
    }, _signal, _onUpdate, ctx) {
      if (!params.confirmWrite) {
        if (!ctx.hasUI || !(await ctx.ui.confirm("Create QDash agent session?", "This will create an agent session in QDash."))) {
          throw new Error("qdash_create_agent_session requires explicit confirmation");
        }
      }
      const client = await makeClient(params);
      const chipId = await defaultChipId(client, params.chipId);
      const data = await client.createAgentSession({
        chipId,
        policy: params.policy as never,
        expiresInSeconds: params.expiresInSeconds,
        skillName: params.skillName ?? "pi-qdash",
        skillVersion: params.skillVersion,
        skillHash: params.skillHash,
        modelName: params.modelName,
      });
      return toToolResult(data, { tool: "qdash_create_agent_session", chipId });
    },
  });

  pi.registerTool({
    name: "qdash_get_agent_session",
    label: "QDash Get Agent Session",
    description: "Get a QDash agent calibration session by sessionId.",
    promptSnippet: "Get QDash agent calibration session details",
    promptGuidelines: ["Use qdash_get_agent_session to inspect QDash agent session state."],
    parameters: Type.Object({ ...connectionParams, sessionId: Type.String() }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string }) {
      const client = await makeClient(params);
      return toToolResult(await client.getAgentSession(params.sessionId), { tool: "qdash_get_agent_session" });
    },
  });

  pi.registerTool({
    name: "qdash_submit_agent_action",
    label: "QDash Submit Agent Action",
    description: "Submit an action to a QDash agent session. This is a write operation and requires confirmation.",
    promptSnippet: "Submit an action to a QDash agent session after explicit user confirmation",
    promptGuidelines: [
      "Use qdash_submit_agent_action only after the user confirms the exact agent action.",
      "Set confirmWrite only after explicit user confirmation.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      sessionId: Type.String(),
      idempotencyKey: Type.Optional(Type.String()),
      expectedStateVersion: Type.Number(),
      actionType: Type.String(),
      taskName: Type.Optional(Type.String()),
      qids: Type.Optional(Type.Array(Type.String())),
      parameterOverrides: Type.Optional(Type.Record(Type.String(), Type.Number())),
      diagnosis: Type.Optional(Type.String()),
      confirmWrite: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: ConfirmableParams & {
      profile?: string;
      configPath?: string;
      useEnv?: boolean;
      sessionId: string;
      idempotencyKey?: string;
      expectedStateVersion: number;
      actionType: string;
      taskName?: string;
      qids?: string[];
      parameterOverrides?: Record<string, number>;
      diagnosis?: string;
    }, _signal, _onUpdate, ctx) {
      if (!params.confirmWrite) {
        if (!ctx.hasUI || !(await ctx.ui.confirm("Submit QDash agent action?", `Submit action '${params.actionType}' to session '${params.sessionId}'?`))) {
          throw new Error("qdash_submit_agent_action requires explicit confirmation");
        }
      }
      const client = await makeClient(params);
      const data = await client.submitAgentAction(params.sessionId, {
        idempotencyKey: params.idempotencyKey ?? randomUUID(),
        expectedStateVersion: params.expectedStateVersion,
        actionType: params.actionType as never,
        taskName: params.taskName,
        qids: params.qids,
        parameterOverrides: params.parameterOverrides,
        diagnosis: params.diagnosis,
      });
      return toToolResult(data, { tool: "qdash_submit_agent_action" });
    },
  });

  pi.registerTool({
    name: "qdash_get_agent_action",
    label: "QDash Get Agent Action",
    description: "Get one QDash agent action by sessionId and actionId.",
    promptSnippet: "Get QDash agent action details",
    promptGuidelines: ["Use qdash_get_agent_action to inspect a submitted QDash agent action."],
    parameters: Type.Object({ ...connectionParams, sessionId: Type.String(), actionId: Type.String() }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string; actionId: string }) {
      const client = await makeClient(params);
      return toToolResult(await client.getAgentAction(params.sessionId, params.actionId), { tool: "qdash_get_agent_action" });
    },
  });

  pi.registerTool({
    name: "qdash_list_agent_actions",
    label: "QDash List Agent Actions",
    description: "List QDash agent actions for a session.",
    promptSnippet: "List QDash agent actions for an agent session",
    promptGuidelines: ["Use qdash_list_agent_actions to inspect actions in a QDash agent session."],
    parameters: Type.Object({ ...connectionParams, sessionId: Type.String() }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string }) {
      const client = await makeClient(params);
      return toToolResult(await client.listAgentActions(params.sessionId), { tool: "qdash_list_agent_actions" });
    },
  });

  pi.registerTool({
    name: "qdash_wait_agent_action",
    label: "QDash Wait Agent Action",
    description: "Wait for a QDash agent action to be dispatched or linked to an execution.",
    promptSnippet: "Poll QDash until an agent action is dispatched or linked to execution",
    promptGuidelines: ["Use qdash_wait_agent_action after submitting an agent action when the user wants polling."],
    parameters: Type.Object({
      ...connectionParams,
      sessionId: Type.String(),
      actionId: Type.String(),
      waitForExecution: Type.Optional(Type.Boolean({ description: "If true, wait for execution_id; otherwise wait for operation_id." })),
      timeoutSeconds: Type.Optional(Type.Number()),
      pollIntervalSeconds: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string; actionId: string; waitForExecution?: boolean; timeoutSeconds?: number; pollIntervalSeconds?: number }) {
      const client = await makeClient(params);
      const options = { timeoutSeconds: params.timeoutSeconds, pollIntervalSeconds: params.pollIntervalSeconds };
      const data = params.waitForExecution
        ? await client.waitForAgentActionExecution(params.sessionId, params.actionId, options)
        : await client.waitForAgentAction(params.sessionId, params.actionId, options);
      return toToolResult(data, { tool: "qdash_wait_agent_action" });
    },
  });

  pi.registerTool({
    name: "qdash_list_agent_action_candidates",
    label: "QDash List Agent Action Candidates",
    description: "List candidate parameter updates produced by a QDash agent action.",
    promptSnippet: "List QDash agent action candidates",
    promptGuidelines: ["Use qdash_list_agent_action_candidates before committing or applying candidates."],
    parameters: Type.Object({ ...connectionParams, sessionId: Type.String(), actionId: Type.String() }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string; actionId: string }) {
      const client = await makeClient(params);
      return toToolResult(await client.listAgentActionCandidates(params.sessionId, params.actionId), { tool: "qdash_list_agent_action_candidates" });
    },
  });

  pi.registerTool({
    name: "qdash_execute_agent_action",
    label: "QDash Execute Agent Action",
    description: "Link/execute a QDash agent action from a source execution. This is a write operation and requires confirmation.",
    promptSnippet: "Execute or link a QDash agent action after explicit user confirmation",
    promptGuidelines: ["Use qdash_execute_agent_action only after the user confirms the exact source execution and action."],
    parameters: Type.Object({
      ...connectionParams,
      sessionId: Type.String(),
      actionId: Type.String(),
      sourceExecutionId: Type.String(),
      updateParams: Type.Optional(Type.Boolean()),
      reconfigure: Type.Optional(Type.Boolean()),
      confirmWrite: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: ConfirmableParams & { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string; actionId: string; sourceExecutionId: string; updateParams?: boolean; reconfigure?: boolean }, _signal, _onUpdate, ctx) {
      if (!params.confirmWrite) {
        if (!ctx.hasUI || !(await ctx.ui.confirm("Execute QDash agent action?", `Execute action '${params.actionId}' from execution '${params.sourceExecutionId}'?`))) {
          throw new Error("qdash_execute_agent_action requires explicit confirmation");
        }
      }
      const client = await makeClient(params);
      return toToolResult(await client.executeAgentAction(params.sessionId, params.actionId, {
        sourceExecutionId: params.sourceExecutionId,
        updateParams: params.updateParams,
        reconfigure: params.reconfigure,
      }), { tool: "qdash_execute_agent_action" });
    },
  });

  pi.registerTool({
    name: "qdash_commit_agent_candidate",
    label: "QDash Commit Agent Candidate",
    description: "Commit a QDash agent action candidate. This is a write operation and requires confirmation.",
    promptSnippet: "Commit a QDash agent candidate after explicit user confirmation",
    promptGuidelines: ["Use qdash_commit_agent_candidate only after showing the candidate and receiving explicit confirmation."],
    parameters: Type.Object({
      ...connectionParams,
      sessionId: Type.String(),
      actionId: Type.String(),
      parameterName: Type.String(),
      taskId: Type.String(),
      idempotencyKey: Type.Optional(Type.String()),
      expectedStateVersion: Type.Number(),
      confirmWrite: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: ConfirmableParams & { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string; actionId: string; parameterName: string; taskId: string; idempotencyKey?: string; expectedStateVersion: number }, _signal, _onUpdate, ctx) {
      if (!params.confirmWrite) {
        if (!ctx.hasUI || !(await ctx.ui.confirm("Commit QDash agent candidate?", `Commit candidate '${params.parameterName}' for task '${params.taskId}'?`))) {
          throw new Error("qdash_commit_agent_candidate requires explicit confirmation");
        }
      }
      const client = await makeClient(params);
      const data = await client.commitAgentActionCandidate(params.sessionId, params.actionId, params.parameterName, {
        idempotencyKey: params.idempotencyKey ?? randomUUID(),
        expectedStateVersion: params.expectedStateVersion,
        taskId: params.taskId,
      });
      return toToolResult(data, { tool: "qdash_commit_agent_candidate" });
    },
  });

  pi.registerTool({
    name: "qdash_list_forum_posts",
    label: "QDash List Forum Posts",
    description: "List QDash forum posts with optional category/status/chip/target filters.",
    promptSnippet: "List QDash forum posts",
    promptGuidelines: ["Use qdash_list_forum_posts instead of qdash_query when the user asks for QDash forum posts."],
    parameters: Type.Object({
      ...connectionParams,
      category: Type.Optional(Type.String()),
      status: Type.Optional(Type.String()),
      chipId: Type.Optional(Type.String()),
      targetType: Type.Optional(Type.String()),
      targetId: Type.Optional(Type.String()),
      skip: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; category?: string; status?: string; chipId?: string; targetType?: string; targetId?: string; skip?: number; limit?: number; color?: boolean }) {
      const client = await makeClient(params);
      const data = await client.listForumPosts({
        category: params.category,
        status: params.status,
        chipId: params.chipId ?? currentContext.chipId,
        targetType: params.targetType,
        targetId: params.targetId,
        skip: params.skip,
        limit: params.limit,
      });
      return toTextToolResult(forumListLines(data, "QDash Forum", params.color).join("\n"), data, { tool: "qdash_list_forum_posts" });
    },
    renderResult(result, _options, theme) {
      const data = (result.details as { data?: unknown } | undefined)?.data;
      return textComponent(forumListLines(data, "QDash Forum"), theme);
    },
  });

  pi.registerTool({
    name: "qdash_get_forum_post",
    label: "QDash Get Forum Post",
    description: "Get a QDash forum post by postId.",
    promptSnippet: "Get QDash forum post details",
    promptGuidelines: ["Use qdash_get_forum_post to inspect one QDash forum post."],
    parameters: Type.Object({ ...connectionParams, postId: Type.String(), color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })) }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; postId: string; color?: boolean }) {
      const client = await makeClient(params);
      const data = await client.getForumPost(params.postId);
      const url = qdashWebUrl(client, `/forum/posts/${encodeURIComponent(params.postId)}`);
      return toTextToolResult(`${forumDetailLines(data, "QDash Forum Post", params.color).join("\n")}\nurl ${url}`, withQDashLinks(client, data), { tool: "qdash_get_forum_post", url });
    },
    renderResult(result, _options, theme) {
      const data = (result.details as { data?: unknown } | undefined)?.data;
      return forumDetailComponent(data, theme);
    },
  });

  pi.registerTool({
    name: "qdash_list_forum_replies",
    label: "QDash List Forum Replies",
    description: "List replies for a QDash forum post by postId.",
    promptSnippet: "List replies for a QDash forum post",
    promptGuidelines: ["Use qdash_list_forum_replies to inspect replies on a QDash forum post."],
    parameters: Type.Object({ ...connectionParams, postId: Type.String(), color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })) }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; postId: string; color?: boolean }) {
      const client = await makeClient(params);
      const data = await client.getForumPostReplies(params.postId);
      const url = qdashWebUrl(client, `/forum/posts/${encodeURIComponent(params.postId)}`);
      return toTextToolResult(`${forumListLines(data, "QDash Forum Replies", params.color).join("\n")}\nurl ${url}`, data, { tool: "qdash_list_forum_replies", url });
    },
    renderResult(result, _options, theme) {
      const data = (result.details as { data?: unknown } | undefined)?.data;
      return textComponent(forumListLines(data, "QDash Forum Replies"), theme, true);
    },
  });

  pi.registerTool({
    name: "qdash_create_forum_post",
    label: "QDash Create Forum Post",
    description: "Create a QDash forum post. This is a write operation and requires confirmation.",
    promptSnippet: "Create a QDash forum post after explicit user confirmation",
    promptGuidelines: ["Use qdash_create_forum_post only after the user confirms the exact post contents."],
    parameters: Type.Object({
      ...connectionParams,
      request: Type.Any({ description: "ForumPostCreate request body accepted by QDash." }),
      confirmWrite: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: ConfirmableParams & { profile?: string; configPath?: string; useEnv?: boolean; request: unknown }, _signal, _onUpdate, ctx) {
      if (!params.confirmWrite) {
        if (!ctx.hasUI || !(await ctx.ui.confirm("Create QDash forum post?", "This will create a forum post in QDash."))) {
          throw new Error("qdash_create_forum_post requires explicit confirmation");
        }
      }
      const client = await makeClient(params);
      return toToolResult(await client.createForumPost(params.request as never), { tool: "qdash_create_forum_post" });
    },
  });

  pi.registerTool({
    name: "qdash_preview_forum_evidence_reply",
    label: "QDash Preview Forum Evidence Reply",
    description: "Preview a QDash forum evidence reply generated from a task result. Read-only; no forum post is created.",
    promptSnippet: "Prepare and review QDash evidence reply content before publishing it",
    promptGuidelines: [
      "Use qdash_preview_forum_evidence_reply before publishing investigated calibration evidence.",
      "After the user approves the preview, use qdash_create_forum_evidence_reply to write it.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      parentPostId: Type.String(),
      taskId: Type.String(),
      interpretation: Type.String({ description: "Human-readable interpretation or hypothesis to append after the task links and figures." }),
      title: Type.Optional(Type.String()),
      includeFigures: Type.Optional(Type.Boolean()),
      maxFigures: Type.Optional(Type.Number()),
      includeHistory: Type.Optional(Type.Boolean()),
      historyLimit: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; parentPostId: string; taskId: string; interpretation: string; title?: string; includeFigures?: boolean; maxFigures?: number; includeHistory?: boolean; historyLimit?: number }) {
      const client = await makeClient(params);
      const built = await buildForumEvidenceReply(client, params);
      return toTextToolResult(built.preview, { preview: built.preview, parent: built.parent, task: built.task, figures: built.figures }, { tool: "qdash_preview_forum_evidence_reply" });
    },
  });

  pi.registerTool({
    name: "qdash_create_forum_evidence_reply",
    label: "QDash Create Forum Evidence Reply",
    description: "Create a QDash forum reply from a task result, embedding task figures as visible QDash UI image blocks. This is a write operation and requires confirmation.",
    promptSnippet: "Create a QDash forum evidence reply with visible task figures after explicit confirmation",
    promptGuidelines: ["Use qdash_create_forum_evidence_reply when adding investigated task evidence to an existing forum thread; show the generated content and require confirmation before writing."],
    parameters: Type.Object({
      ...connectionParams,
      parentPostId: Type.String(),
      taskId: Type.String(),
      interpretation: Type.String({ description: "Human-readable interpretation or hypothesis to append after the task links and figures." }),
      title: Type.Optional(Type.String()),
      includeFigures: Type.Optional(Type.Boolean()),
      maxFigures: Type.Optional(Type.Number()),
      includeHistory: Type.Optional(Type.Boolean()),
      historyLimit: Type.Optional(Type.Number()),
      confirmWrite: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: ConfirmableParams & { profile?: string; configPath?: string; useEnv?: boolean; parentPostId: string; taskId: string; interpretation: string; title?: string; includeFigures?: boolean; maxFigures?: number; includeHistory?: boolean; historyLimit?: number }, _signal, _onUpdate, ctx) {
      const client = await makeClient(params);
      const built = await buildForumEvidenceReply(client, params);
      if (!params.confirmWrite) {
        const confirmed = ctx.hasUI && await ctx.ui.confirm("Create QDash forum evidence reply?", built.preview.slice(0, 1800));
        if (!confirmed) throw new Error("qdash_create_forum_evidence_reply requires explicit confirmation");
      }
      const data = await client.createForumPost(built.request as never);
      const postId = firstString(data as unknown as Record<string, unknown>, ["id"]);
      const parentUrl = qdashWebUrl(client, `/forum/posts/${encodeURIComponent(params.parentPostId)}`);
      const text = [`created forum evidence reply${postId ? ` ${postId}` : ""}`, `parent ${parentUrl}`, "", built.preview].join("\n");
      return toTextToolResult(text, { reply: data, preview: built.preview, figures: built.figures }, { tool: "qdash_create_forum_evidence_reply", url: parentUrl });
    },
  });

  pi.registerTool({
    name: "qdash_update_forum_post",
    label: "QDash Update Forum Post",
    description: "Update a QDash forum post. This is a write operation and requires confirmation.",
    promptSnippet: "Update a QDash forum post after explicit user confirmation",
    promptGuidelines: ["Use qdash_update_forum_post only after the user confirms the exact post update."],
    parameters: Type.Object({
      ...connectionParams,
      postId: Type.String(),
      request: Type.Any({ description: "ForumPostUpdate request body accepted by QDash." }),
      confirmWrite: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: ConfirmableParams & { profile?: string; configPath?: string; useEnv?: boolean; postId: string; request: unknown }, _signal, _onUpdate, ctx) {
      if (!params.confirmWrite) {
        if (!ctx.hasUI || !(await ctx.ui.confirm("Update QDash forum post?", `Update forum post '${params.postId}'?`))) {
          throw new Error("qdash_update_forum_post requires explicit confirmation");
        }
      }
      const client = await makeClient(params);
      return toToolResult(await client.updateForumPost(params.postId, params.request as never), { tool: "qdash_update_forum_post" });
    },
  });

  pi.registerTool({
    name: "qdash_commit_agent_campaign_candidates",
    label: "QDash Commit Agent Campaign Candidates",
    description: "Commit multiple QDash agent campaign candidates. This is a write operation and requires confirmation.",
    promptSnippet: "Commit multiple QDash agent candidates after explicit user confirmation",
    promptGuidelines: ["Use qdash_commit_agent_campaign_candidates only after showing the candidate set and receiving explicit confirmation."],
    parameters: Type.Object({
      ...connectionParams,
      sessionId: Type.String(),
      candidates: Type.Array(Type.Any({ description: "Agent campaign candidate references accepted by QDash." })),
      idempotencyKey: Type.Optional(Type.String()),
      expectedStateVersion: Type.Number(),
      confirmWrite: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: ConfirmableParams & { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string; candidates: unknown[]; idempotencyKey?: string; expectedStateVersion: number }, _signal, _onUpdate, ctx) {
      if (!params.confirmWrite) {
        if (!ctx.hasUI || !(await ctx.ui.confirm("Commit QDash agent campaign candidates?", `Commit ${params.candidates.length} candidate(s)?`))) {
          throw new Error("qdash_commit_agent_campaign_candidates requires explicit confirmation");
        }
      }
      const client = await makeClient(params);
      return toToolResult(await client.commitAgentCampaignCandidates(params.sessionId, params.candidates as never, {
        idempotencyKey: params.idempotencyKey ?? randomUUID(),
        expectedStateVersion: params.expectedStateVersion,
      }), { tool: "qdash_commit_agent_campaign_candidates" });
    },
  });

  pi.registerTool({
    name: "qdash_get_agent_candidate_commit",
    label: "QDash Get Agent Candidate Commit",
    description: "Get a QDash agent candidate commit by commitId.",
    promptSnippet: "Get QDash agent candidate commit status",
    promptGuidelines: ["Use qdash_get_agent_candidate_commit to inspect a candidate commit before applying it."],
    parameters: Type.Object({ ...connectionParams, sessionId: Type.String(), commitId: Type.String() }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string; commitId: string }) {
      const client = await makeClient(params);
      return toToolResult(await client.getAgentCandidateCommit(params.sessionId, params.commitId), { tool: "qdash_get_agent_candidate_commit" });
    },
  });

  pi.registerTool({
    name: "qdash_apply_agent_candidate_commit",
    label: "QDash Apply Agent Candidate Commit",
    description: "Apply a QDash agent candidate commit to backend configuration. This is a write operation and requires confirmation.",
    promptSnippet: "Apply a QDash agent candidate commit after explicit user confirmation",
    promptGuidelines: ["Use qdash_apply_agent_candidate_commit only after showing the commit and receiving explicit confirmation."],
    parameters: Type.Object({
      ...connectionParams,
      sessionId: Type.String(),
      commitId: Type.String(),
      idempotencyKey: Type.Optional(Type.String()),
      expectedStateVersion: Type.Number(),
      pushToGithub: Type.Optional(Type.Boolean()),
      confirmWrite: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: ConfirmableParams & { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string; commitId: string; idempotencyKey?: string; expectedStateVersion: number; pushToGithub?: boolean }, _signal, _onUpdate, ctx) {
      if (!params.confirmWrite) {
        if (!ctx.hasUI || !(await ctx.ui.confirm("Apply QDash agent candidate commit?", `Apply commit '${params.commitId}' to backend configuration?`))) {
          throw new Error("qdash_apply_agent_candidate_commit requires explicit confirmation");
        }
      }
      const client = await makeClient(params);
      return toToolResult(await client.applyAgentCandidateCommit(params.sessionId, params.commitId, {
        idempotencyKey: params.idempotencyKey ?? randomUUID(),
        expectedStateVersion: params.expectedStateVersion,
        pushToGithub: params.pushToGithub,
      }), { tool: "qdash_apply_agent_candidate_commit" });
    },
  });

  pi.registerTool({
    name: "qdash_wait_agent_candidate_apply",
    label: "QDash Wait Agent Candidate Apply",
    description: "Wait for a QDash agent candidate commit apply operation to finish.",
    promptSnippet: "Poll QDash until a candidate apply operation finishes",
    promptGuidelines: ["Use qdash_wait_agent_candidate_apply after applying a candidate commit when the user wants polling."],
    parameters: Type.Object({ ...connectionParams, sessionId: Type.String(), commitId: Type.String(), timeoutSeconds: Type.Optional(Type.Number()), pollIntervalSeconds: Type.Optional(Type.Number()) }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; sessionId: string; commitId: string; timeoutSeconds?: number; pollIntervalSeconds?: number }) {
      const client = await makeClient(params);
      return toToolResult(await client.waitForAgentCandidateApply(params.sessionId, params.commitId, { timeoutSeconds: params.timeoutSeconds, pollIntervalSeconds: params.pollIntervalSeconds }), { tool: "qdash_wait_agent_candidate_apply" });
    },
  });

  pi.registerTool({
    name: "qdash_recent_calibration_figure",
    label: "QDash Recent Calibration Figure",
    description: "Fetch and render a figure from a recent calibration result without requiring a task ID.",
    promptSnippet: "Show a recent QDash calibration experiment image",
    promptGuidelines: ["Use qdash_recent_calibration_figure when the user asks to see recent calibration images and has not provided a task ID."],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      taskIndex: Type.Optional(Type.Number({ description: "Recent task index, newest first. Defaults to 0." })),
      figureIndex: Type.Optional(Type.Number({ description: "Figure index within the selected task. Defaults to 0." })),
      withinHours: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; taskIndex?: number; figureIndex?: number; withinHours?: number }) {
      const client = await makeClient(params);
      const chipId = await defaultChipId(client, params.chipId);
      const end = new Date();
      const start = new Date(end.getTime() - (params.withinHours ?? 168) * 3600_000);
      const payload = await client.listTaskResults({ chipId, startAt: start.toISOString(), endAt: end.toISOString(), limit: 50 });
      const tasks = arrayFromPayload(payload).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
      const task = tasks[params.taskIndex ?? 0];
      const taskId = task && firstString(task, ["task_id", "taskId"]);
      if (!taskId) throw new Error("No recent calibration task result with a task ID was found");
      const file: TaskResultFigureFile = await client.getTaskResultFigure(taskId, { index: params.figureIndex ?? 0 });
      const bytes = Buffer.from(file.data);
      const mediaType = file.mediaType || mediaTypeForPath(file.path ?? "");
      const details: FigureDetails = { tool: "qdash_recent_calibration_figure", taskId, path: file.path ?? "", mediaType, sizeBytes: bytes.byteLength, figurePaths: file.figurePaths ?? [], jsonFigurePaths: file.jsonFigurePaths ?? [] };
      if (mediaType.startsWith("image/")) details.base64 = bytes.toString("base64");
      else details.text = bytes.toString("utf8");
      return toTextToolResult(figureResultText(details), { task, selectedPath: details.path }, details);
    },
    renderResult(result, _options, theme) {
      return figureComponent(result.details as unknown as FigureDetails, theme);
    },
  });

  pi.registerTool({
    name: "qdash_get_figure",
    label: "QDash Get Figure",
    description: "Fetch a QDash calibration figure by absolute figure path and render images in interactive TUI.",
    promptSnippet: "Fetch and render a QDash calibration figure image or JSON figure by path",
    promptGuidelines: ["Use qdash_get_figure when the user asks to inspect a calibration figure path from a task result or execution."],
    parameters: Type.Object({
      ...connectionParams,
      path: Type.String({ description: "Absolute figure path, e.g. /app/calib_data/.../fig/Figure.png" }),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; path: string }) {
      const client = await makeClient(params);
      const details = await fetchFigureDetails(client, params.path);
      return toTextToolResult(figureResultText(details), { path: params.path }, details);
    },
    renderResult(result, _options, theme) {
      return figureComponent(result.details as unknown as FigureDetails, theme);
    },
  });

  pi.registerTool({
    name: "qdash_get_task_figures",
    label: "QDash Get Task Figures",
    description: "Fetch figure paths from a QDash task result and render one selected figure in interactive TUI.",
    promptSnippet: "Fetch and render calibration figures associated with a QDash task result",
    promptGuidelines: ["Use qdash_get_task_figures after inspecting a task result with figure_path/json_figure_path."],
    parameters: Type.Object({
      ...connectionParams,
      taskId: Type.String(),
      index: Type.Optional(Type.Number({ description: "Figure index to fetch. Defaults to 0." })),
      preferJson: Type.Optional(Type.Boolean({ description: "Fetch json_figure_path instead of figure_path when available." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; taskId: string; index?: number; preferJson?: boolean }) {
      const client = await makeClient(params);
      try {
        const options: TaskResultFigureOptions = { index: params.index, preferJson: params.preferJson };
        const file: TaskResultFigureFile = await client.getTaskResultFigure(params.taskId, options);
        const bytes = Buffer.from(file.data);
        const mediaType = file.mediaType || mediaTypeForPath(file.path ?? "");
        const details: FigureDetails = {
          tool: "qdash_get_task_figures",
          taskId: params.taskId,
          path: file.path ?? "",
          mediaType,
          sizeBytes: bytes.byteLength,
          figurePaths: file.figurePaths ?? [],
          jsonFigurePaths: file.jsonFigurePaths ?? [],
        };
        if (mediaType.startsWith("image/")) details.base64 = bytes.toString("base64");
        else details.text = bytes.toString("utf8");
        return toTextToolResult(figureResultText(details), { taskId: params.taskId, figurePaths: details.figurePaths, jsonFigurePaths: details.jsonFigurePaths, selectedPath: details.path }, details);
      } catch (error) {
        return toTextToolResult(boxed("QDash Task Figures", [
          `task ${params.taskId}`,
          "",
          error instanceof Error ? error.message : String(error),
        ]).join("\n"), { taskId: params.taskId, error: error instanceof Error ? error.message : String(error) }, { tool: "qdash_get_task_figures", taskId: params.taskId, path: "", mediaType: "", sizeBytes: 0 } satisfies FigureDetails);
      }
    },
    renderResult(result, _options, theme) {
      return figureComponent(result.details as unknown as FigureDetails, theme);
    },
  });

  registerQueryTool({
    name: "qdash_get_provenance_stats",
    label: "QDash Provenance Stats",
    description: "Get QDash provenance statistics.",
    promptSnippet: "Get QDash provenance stats",
    action: "provenance_stats",
    parameters: Type.Object(connectionParams),
  });

  pi.registerTool({
    name: "qdash_degradation_report",
    label: "QDash Degradation Report",
    description: "Show read-only provenance degradation trends, recent parameter changes, execution lock state, and optional downstream recalibration recommendations.",
    promptSnippet: "Inspect QDash degradation trends and recalibration impact before changing parameters",
    promptGuidelines: [
      "Use qdash_degradation_report before planning calibration changes or when investigating drift.",
      "The execution lock is a safety signal, not permission to bypass confirmation or start work.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      withinHours: Type.Optional(Type.Number()),
      minStreak: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
      entityId: Type.Optional(Type.String({ description: "Optional provenance entity ID for downstream recalibration recommendations." })),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; withinHours?: number; minStreak?: number; limit?: number; entityId?: string; color?: boolean }) {
      const report = await buildDegradationReport(params);
      return toTextToolResult(degradationReportLines(report, params.color).join("\\n"), report, { tool: "qdash_degradation_report", webBaseUrl: report.context.webBaseUrl });
    },
    renderResult(result, _options, theme) {
      const report = (result.details as { data?: DegradationReport } | undefined)?.data;
      return report ? textComponent(degradationReportLines(report).join("\\n").split("\\n"), theme) : textComponent(["No degradation report"], theme);
    },
  });

  pi.registerTool({
    name: "qdash_validate_calibration",
    label: "QDash Validate Calibration",
    description: "Validate a calibration task result with explicit gates for status, issues, and figures. Read-only; does not commit or apply candidates.",
    promptSnippet: "Validate a QDash calibration result before continuing or committing parameters",
    promptGuidelines: [
      "Use qdash_validate_calibration after an operational task completes or fails.",
      "A passed validation is not approval to commit or apply parameters; require explicit confirmation for those writes.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      taskId: Type.String(),
      beforeExecutionId: Type.Optional(Type.String({ description: "Optional earlier execution ID to compare against the task's execution." })),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; taskId: string; beforeExecutionId?: string; color?: boolean }) {
      const validation = await buildCalibrationValidation(params);
      return toTextToolResult(calibrationValidationLines(validation, params.color).join("\\n"), validation, { tool: "qdash_validate_calibration", webBaseUrl: validation.context.webBaseUrl });
    },
    renderResult(result, _options, theme) {
      const validation = (result.details as { data?: CalibrationValidation } | undefined)?.data;
      return validation ? textComponent(calibrationValidationLines(validation).join("\\n").split("\\n"), theme) : textComponent(["No calibration validation"], theme);
    },
  });

  pi.registerTool({
    name: "qdash_plan_calibration",
    label: "QDash Plan Calibration",
    description: "Create a read-only dry-run calibration plan for one qubit or coupling. It never executes tasks or changes parameters.",
    promptSnippet: "Plan a safe QDash calibration workflow without executing it",
    promptGuidelines: [
      "Use qdash_plan_calibration after inspecting a target and before any operational calibration action.",
      "Present the plan and require explicit confirmation for each write or task-execution step.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      qid: Type.Optional(Type.String()),
      couplingId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      withinHours: Type.Optional(Type.Number()),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; qid?: string; couplingId?: string; limit?: number; withinHours?: number; color?: boolean }) {
      const report = await buildTargetOperationsReport(params);
      const plan = buildCalibrationPlan(report);
      return toTextToolResult(calibrationPlanLines(plan, params.color).join("\\n"), plan, { tool: "qdash_plan_calibration" });
    },
    renderResult(result, _options, theme) {
      const plan = (result.details as { data?: CalibrationPlan } | undefined)?.data;
      return plan ? textComponent(calibrationPlanLines(plan).join("\\n").split("\\n"), theme) : textComponent(["No calibration plan"], theme);
    },
  });

  pi.registerTool({
    name: "qdash_target_report",
    label: "QDash Target Report",
    description: "Build a read-only operational report for one qubit or coupling, correlating recent results, failures, issues, forum context, and a safe next-action recommendation.",
    promptSnippet: "Inspect one QDash qubit or coupling as an operational incident report",
    promptGuidelines: [
      "Use qdash_target_report before calibration changes when a specific qubit or coupling is under investigation.",
      "This is read-only; do not treat the recommendation as approval to execute or commit a calibration action.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      qid: Type.Optional(Type.String({ description: "Qubit ID. Defaults to the selected QDash target." })),
      couplingId: Type.Optional(Type.String({ description: "Coupling ID. Defaults to the selected QDash target." })),
      limit: Type.Optional(Type.Number()),
      withinHours: Type.Optional(Type.Number({ description: "Lookback window. Defaults to 168 hours." })),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; qid?: string; couplingId?: string; limit?: number; withinHours?: number; color?: boolean }) {
      const report = await buildTargetOperationsReport(params);
      return toTextToolResult(targetOperationsReportLines(report, params.color).join("\\n"), report, { tool: "qdash_target_report", webBaseUrl: report.context.webBaseUrl });
    },
    renderResult(result, _options, theme) {
      const report = (result.details as { data?: TargetOperationsReport } | undefined)?.data;
      return report ? textComponent(targetOperationsReportLines(report).join("\\n").split("\\n"), theme) : textComponent(["No target report"], theme);
    },
  });

  pi.registerTool({
    name: "qdash_dashboard",
    label: "QDash Dashboard",
    description: "Build a compact read-only QDash dashboard for the current profile/chip context.",
    promptSnippet: "Show QDash harness dashboard: chips, open issues, recent executions, failed task results, and provenance stats",
    promptGuidelines: [
      "Use qdash_dashboard when the user asks for QDash status, overview, triage, or a dashboard.",
      "Summarize dashboard data instead of dumping large raw payloads.",
    ],
    parameters: Type.Object({ ...connectionParams, ...chipScopedParams, limit: Type.Optional(Type.Number()), color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })) }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; limit?: number; color?: boolean }) {
      const dashboard = await buildDashboard(params);
      return toTextToolResult(dashboardLines(dashboard, params.color).join("\n"), dashboard, { tool: "qdash_dashboard", lines: dashboardLines(dashboard) });
    },
    renderCall(args, theme) {
      const profile = args.profile ?? currentContext.profile ?? "context";
      return new Text(theme.fg("toolTitle", theme.bold("qdash_dashboard ")) + theme.fg("muted", profile), 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details as { data?: Awaited<ReturnType<typeof buildDashboard>> } | undefined;
      if (details?.data) return dashboardComponent(details.data, theme);
      return new Text(theme.fg("dim", "QDash dashboard unavailable"), 0, 0);
    },
  });

  pi.registerTool({
    name: "qdash_dashboard_insights",
    label: "QDash Dashboard Insights",
    description: "Correlate dashboard metrics, open forum posts, notes/issues, and failed tasks into target-level insights with links.",
    promptSnippet: "Generate QDash target insights from dashboard metrics, forum links, notes, and failed tasks",
    promptGuidelines: ["Use qdash_dashboard_insights when the user asks for insights across dashboard metrics, target summaries, forum posts, notes, issues, or anomalous targets."],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      withinHours: Type.Optional(Type.Number()),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; limit?: number; withinHours?: number; color?: boolean }) {
      const result = await buildDashboardInsights(params);
      return toTextToolResult(dashboardInsightLines(result, params.color).join("\n"), result, { tool: "qdash_dashboard_insights", webBaseUrl: result.context.webBaseUrl });
    },
    renderResult(result, _options, theme) {
      const data = (result.details as { data?: DashboardInsightsResult } | undefined)?.data;
      return data ? textComponent(dashboardInsightLines(data).join("\n").split("\n"), theme) : textComponent(["No dashboard insights"], theme);
    },
  });

  pi.registerTool({
    name: "qdash_compare_calibration",
    label: "QDash Compare Calibration",
    description: "Compare repeated calibration results for one qubit or coupling without changing parameters.",
    promptSnippet: "Compare the latest QDash calibration with the previous one",
    promptGuidelines: ["Use qdash_compare_calibration when the user asks what changed between recent calibration experiments."],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      qid: Type.Optional(Type.String()),
      couplingId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; qid?: string; couplingId?: string; limit?: number; color?: boolean }) {
      const comparison = await buildCalibrationComparison(params);
      return toTextToolResult(calibrationComparisonLines(comparison, params.color).join("\\n"), comparison, { tool: "qdash_compare_calibration", webBaseUrl: comparison.context.webBaseUrl });
    },
    renderResult(result, _options, theme) {
      const comparison = (result.details as { data?: CalibrationComparison } | undefined)?.data;
      return comparison ? textComponent(calibrationComparisonLines(comparison).join("\\n").split("\\n"), theme) : textComponent(["No calibration comparison"], theme);
    },
  });

  pi.registerTool({
    name: "qdash_investigate",
    label: "QDash Investigate",
    description: "Run a read-only natural-language-friendly QDash investigation combining recent calibration results, target history, failures, issues, forum context, and safe recommendations.",
    promptSnippet: "Investigate a QDash target or recent calibration by correlating results, figures, issues, and Forum context",
    promptGuidelines: [
      "Use qdash_investigate when the user asks to investigate, compare, or understand a QDash target or recent calibration in natural language.",
      "This tool is read-only; do not execute tasks or change parameters based on its recommendation without explicit confirmation.",
    ],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      qid: Type.Optional(Type.String()),
      couplingId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      withinHours: Type.Optional(Type.Number()),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; qid?: string; couplingId?: string; limit?: number; withinHours?: number; color?: boolean }) {
      const report = await buildInvestigationReport(params);
      return toTextToolResult(investigationLines(report, params.color).join("\\n"), report, { tool: "qdash_investigate", webBaseUrl: report.context.webBaseUrl });
    },
    renderResult(result, _options, theme) {
      const report = (result.details as { data?: InvestigationReport } | undefined)?.data;
      return report ? textComponent(investigationLines(report).join("\\n").split("\\n"), theme) : textComponent(["No QDash investigation"], theme);
    },
  });

  pi.registerTool({
    name: "qdash_recent_calibration_summary",
    label: "QDash Recent Calibration Summary",
    description: "Summarize recent calibration task outcomes with QDash Web UI links.",
    promptSnippet: "Summarize recent QDash calibration results and return task/execution URLs",
    promptGuidelines: ["Use qdash_recent_calibration_summary when the user asks for recent calibration results, what happened, or quick links to details."],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      withinHours: Type.Optional(Type.Number()),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; limit?: number; withinHours?: number; color?: boolean }) {
      const summary = await buildRecentCalibrationSummary(params);
      return toTextToolResult(recentCalibrationSummaryLines(summary, params.color).join("\n"), summary, { tool: "qdash_recent_calibration_summary", webBaseUrl: summary.context.webBaseUrl });
    },
    renderResult(result, _options, theme) {
      const summary = (result.details as { data?: RecentCalibrationSummary } | undefined)?.data;
      return summary ? recentCalibrationSummaryComponent(summary, theme) : textComponent(["No calibration summary"], theme);
    },
  });

  pi.registerTool({
    name: "qdash_recommend_next_action",
    label: "QDash Recommend Next Action",
    description: "Recommend the next safe calibration action from recent task outcomes and current target context.",
    promptSnippet: "Recommend the next QDash calibration action",
    promptGuidelines: ["Use qdash_recommend_next_action before continuing autonomous calibration after a failed or completed calibration task."],
    parameters: Type.Object({
      ...connectionParams,
      chipId: Type.Optional(Type.String()),
      qid: Type.Optional(Type.String()),
      couplingId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      withinHours: Type.Optional(Type.Number()),
      color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })),
    }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; qid?: string; couplingId?: string; limit?: number; withinHours?: number; color?: boolean }) {
      const summary = await buildRecentCalibrationSummary(params);
      const target = params.qid ?? currentContext.qid ?? params.couplingId ?? currentContext.couplingId;
      const recommendations = recommendFromCalibrationSummary(summary, target);
      return toTextToolResult(recommendationLines(recommendations, params.color).join("\n"), { recommendations, summary }, { tool: "qdash_recommend_next_action", webBaseUrl: summary.context.webBaseUrl });
    },
    renderResult(result, _options, theme) {
      const recommendations = ((result.details as { data?: { recommendations?: RecommendedNextAction[] } } | undefined)?.data?.recommendations) ?? [];
      return textComponent(recommendationLines(recommendations).join("\n").split("\n"), theme);
    },
  });

  pi.registerTool({
    name: "qdash_triage_overview",
    label: "QDash Triage Overview",
    description: "Create a read-only triage overview from open issues and failed task results for the current QDash context.",
    promptSnippet: "Summarize QDash open issues and failed task results for triage",
    promptGuidelines: ["Use qdash_triage_overview when the user asks what to investigate next in QDash."],
    parameters: Type.Object({ ...connectionParams, ...chipScopedParams, limit: Type.Optional(Type.Number()), color: Type.Optional(Type.Boolean({ description: "Emit ANSI colors in text output for terminal display." })) }),
    async execute(_toolCallId, params: { profile?: string; configPath?: string; useEnv?: boolean; chipId?: string; limit?: number; color?: boolean }) {
      const dashboard = await buildDashboard(params);
      const triage = {
        context: dashboard.context,
        openIssues: dashboard.openIssues,
        failedTaskResults: dashboard.failedTaskResults,
        suggestedFocus: [
          dashboard.failedTaskResults.count > 0 ? "Review failed task results first." : undefined,
          dashboard.openIssues.count > 0 ? "Review open issues and correlate with recent executions." : undefined,
        ].filter(Boolean),
      };
      const accent = (text: string) => params.color ? ansi("1;36", text) : text;
      const dim = (text: string) => params.color ? ansi("2", text) : text;
      const success = (text: string) => params.color ? ansi("32", text) : text;
      const error = (text: string) => params.color ? ansi("31", text) : text;
      const lines = boxed("QDash Triage", [
        `open issues ${triage.openIssues.count > 0 ? ansi("33", String(triage.openIssues.count)) : success(String(triage.openIssues.count))}`,
        `failed tasks ${triage.failedTaskResults.count > 0 ? error(`${triage.failedTaskResults.shown}/${triage.failedTaskResults.count}`) : success(`${triage.failedTaskResults.shown}/${triage.failedTaskResults.count}`)}`,
        "",
        accent("Suggested focus"),
        ...(triage.suggestedFocus.length > 0 ? triage.suggestedFocus.map((item) => `  - ${params.color ? ansi("33", item ?? "") : item}`) : [`  ${dim("none")}`]),
        "",
        accent("Failed task results"),
        ...(dashboard.failedTaskResults.items.length > 0 ? dashboard.failedTaskResults.items.map((item, index) => `  ${params.color ? error(formatItem(item, `task-${index + 1}`)) : formatItem(item, `task-${index + 1}`)}`) : [`  ${dim("none")}`]),
      ], params.color);
      return toTextToolResult(lines.join("\n"), triage, { tool: "qdash_triage_overview" });
    },
    renderResult(result, _options, theme) {
      const data = (result.details as { data?: { openIssues?: { count?: number }; failedTaskResults?: { count?: number }; suggestedFocus?: string[] } } | undefined)?.data;
      if (!data) return new Text(theme.fg("dim", "QDash triage unavailable"), 0, 0);
      const lines = [
        theme.fg("accent", theme.bold("QDash Triage")),
        `${theme.fg("muted", "open issues")} ${theme.fg((data.openIssues?.count ?? 0) > 0 ? "warning" : "success", String(data.openIssues?.count ?? 0))}`,
        `${theme.fg("muted", "failed tasks")} ${theme.fg((data.failedTaskResults?.count ?? 0) > 0 ? "error" : "success", String(data.failedTaskResults?.count ?? 0))}`,
        "",
        theme.fg("borderAccent", "Suggested focus"),
        ...(data.suggestedFocus?.length ? data.suggestedFocus.map((item) => `  ${theme.fg("warning", item)}`) : [`  ${theme.fg("dim", "none")}`]),
      ];
      return new Text(lines.join("\n"), 0, 0);
    },
  });

  pi.registerTool({
    name: "qdash_raw_get",
    label: "QDash Raw GET",
    description: "Run a read-only raw GET request through qdash-client transport for endpoints not covered by qdash_query.",
    promptSnippet: "Call a read-only QDash GET endpoint through qdash-client",
    promptGuidelines: ["Use qdash_raw_get only for read-only QDash endpoints not covered by qdash_query. Do not use it for operationally sensitive endpoints without user confirmation."],
    parameters: Type.Object({
      ...connectionParams,
      path: Type.String({ description: "API path, e.g. /task-results/timeseries" }),
      query: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_toolCallId, params: RawGetParams) {
      if (!params.path.startsWith("/")) throw new Error("path must start with '/'");
      if (/\/files\/git\/(pull|push)|\/flows\/[^/]+\/execute|\/executions\/[^/]+\/re-execute|\/admin\b|\/auth\b/i.test(params.path)) {
        throw new Error("This endpoint is operationally sensitive; ask the user for explicit confirmation and use an appropriate dedicated workflow.");
      }
      const client = await makeClient(params);
      const data = await (client as unknown as { get<T>(path: string, query?: unknown): Promise<T> }).get(params.path, params.query ?? {});
      return toToolResult(data, { path: params.path });
    },
  });

  const persistContext = () => {
    const context = { ...currentContext };
    pi.appendEntry(CONTEXT_ENTRY_TYPE, context);
    saveGlobalContext(context);
  };

  const refreshContextUi = (ctx: { ui: { theme?: Theme; setStatus: (key: string, value: string) => void; setWidget?: (key: string, lines: string[]) => void } }) => {
    ctx.ui.setStatus("qdash", contextStatusLine(ctx.ui.theme));
  };

  const ensureActiveChip = async () => {
    if (currentContext.chipId) return false;
    const client = await makeClient({ profile: currentContext.profile });
    currentContext = { ...currentContext, chipId: await client.getDefaultChipId() };
    return true;
  };

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || !event.toolName.startsWith("qdash_")) return;
    if (!adoptContextFromToolInput(event.input)) return;
    try {
      await ensureActiveChip();
    } catch {
      // Keep the selected profile visible even if QDash cannot resolve chips right now.
    }
    persistContext();
    if (ctx.hasUI) refreshContextUi(ctx);
  });

  pi.registerCommand("qdash-setup", {
    description: "Quickly configure QDash context; usage: /qdash-setup [profile] [chip_id]",
    handler: async (args, ctx) => {
      const [profileArg, chipArg] = args.trim().split(/\s+/).filter(Boolean);
      const profile = profileArg ?? currentContext.profile ?? "default";
      try {
        const client = await makeClient({ profile });
        const chipId = chipArg ?? currentContext.chipId ?? await client.getDefaultChipId();
        currentContext = { ...currentContext, profile, chipId };
        persistContext();
        refreshContextUi(ctx);
        const dashboard = await buildDashboard({ profile, chipId, limit: 5 });
        ctx.ui.setWidget("qdash", (_tui, theme) => dashboardComponent(dashboard, theme));
        ctx.ui.notify(`QDash setup complete: profile ${profile}, chip ${chipId}`, "info");
      } catch (error) {
        ctx.ui.notify(`QDash setup failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("qdash-use-profile", {
    description: "Set the current QDash profile for this pi session",
    handler: async (args, ctx) => {
      const profile = args.trim();
      if (!profile) {
        ctx.ui.notify("Usage: /qdash-use-profile <profile>", "warning");
        return;
      }
      const client = await makeClient({ profile });
      currentContext = { ...currentContext, profile, chipId: await client.getDefaultChipId() };
      persistContext();
      refreshContextUi(ctx);
      ctx.ui.notify(`QDash profile set to ${profile}, chip ${currentContext.chipId}`, "info");
    },
  });

  pi.registerCommand("qdash-use-chip", {
    description: "Set the current QDash chip ID for this pi session; omit the argument to use the default chip",
    handler: async (args, ctx) => {
      const requested = args.trim() || undefined;
      const client = await makeClient({});
      const chipId = requested ?? await client.getDefaultChipId();
      currentContext = { ...currentContext, chipId };
      persistContext();
      refreshContextUi(ctx);
      ctx.ui.notify(`QDash chip set to ${chipId}`, "info");
    },
  });

  pi.registerCommand("qdash-use-target", {
    description: "Set the current QDash calibration target; usage: /qdash-use-target qid <qid> | coupling <coupling_id>",
    handler: async (args, ctx) => {
      const [kind, value] = args.trim().split(/\s+/).filter(Boolean);
      if (!kind || !value || !["qid", "q", "qubit", "coupling", "c"].includes(kind)) {
        ctx.ui.notify("Usage: /qdash-use-target qid <qid> | coupling <coupling_id>", "warning");
        return;
      }
      if (["qid", "q", "qubit"].includes(kind)) {
        const { couplingId: _couplingId, ...rest } = currentContext;
        currentContext = { ...rest, qid: value };
      } else {
        const { qid: _qid, ...rest } = currentContext;
        currentContext = { ...rest, couplingId: value };
      }
      persistContext();
      refreshContextUi(ctx);
      ctx.ui.notify(`QDash target set to ${currentContext.qid ? `q${currentContext.qid}` : `c${currentContext.couplingId}`}`, "info");
    },
  });

  pi.registerCommand("qdash-use-agent-session", {
    description: "Set the current QDash agent session ID for this pi session",
    handler: async (args, ctx) => {
      const agentSessionId = args.trim();
      if (!agentSessionId) {
        ctx.ui.notify("Usage: /qdash-use-agent-session <session_id>", "warning");
        return;
      }
      currentContext = { ...currentContext, agentSessionId };
      persistContext();
      refreshContextUi(ctx);
      ctx.ui.notify(`QDash agent session set to ${agentSessionId}`, "info");
    },
  });

  pi.registerCommand("qdash-clear-context", {
    description: "Clear the current QDash profile/chip/agent-session context",
    handler: async (_args, ctx) => {
      currentContext = {};
      persistContext();
      refreshContextUi(ctx);
      ctx.ui.setWidget("qdash", ["QDash context cleared", "profile env/default", "chip auto-chip", "session none"]);
      ctx.ui.notify("QDash context cleared", "info");
    },
  });

  pi.registerCommand("qdash-degradation-report", {
    description: "Show read-only QDash degradation trends and execution lock state",
    handler: async (_args, ctx) => {
      try {
        const report = await buildDegradationReport({});
        refreshContextUi(ctx);
        ctx.ui.setWidget("qdash", (_tui, theme) => textComponent(degradationReportLines(report).slice(1, -1), theme, true));
        ctx.ui.notify(`QDash degradation report updated: ${report.context.chipId}`, "info");
      } catch (error) {
        ctx.ui.notify(`QDash degradation report failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("qdash-plan-calibration", {
    description: "Show a read-only dry-run calibration plan for the selected target",
    handler: async (_args, ctx) => {
      try {
        const report = await buildTargetOperationsReport({});
        const plan = buildCalibrationPlan(report);
        refreshContextUi(ctx);
        ctx.ui.setWidget("qdash", (_tui, theme) => textComponent(calibrationPlanLines(plan).slice(1, -1), theme, true));
        ctx.ui.notify(`QDash dry-run plan prepared: ${plan.target.label}`, "info");
      } catch (error) {
        ctx.ui.notify(`QDash plan failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("qdash-target-report", {
    description: "Show a read-only operational report; usage: /qdash-target-report qid <qid> | coupling <coupling_id>",
    handler: async (args, ctx) => {
      const [kind, value] = args.trim().split(/\\s+/).filter(Boolean);
      const params = kind && value && ["qid", "q", "qubit", "coupling", "c"].includes(kind)
        ? ["qid", "q", "qubit"].includes(kind) ? { qid: value } : { couplingId: value }
        : {};
      try {
        const report = await buildTargetOperationsReport(params);
        refreshContextUi(ctx);
        ctx.ui.setWidget("qdash", (_tui, theme) => textComponent(targetOperationsReportLines(report).slice(1, -1), theme, true));
        ctx.ui.notify(`QDash target report updated: ${report.target.label}`, "info");
      } catch (error) {
        ctx.ui.notify(`QDash target report failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("qdash-wiring-insights", {
    description: "Show wiring attenuation insights for the active/newest cooldown",
    handler: async (_args, ctx) => {
      try {
        const data = await resolveCooldownWiring({ includeBlocks: false, includeHistory: false, includeInsights: true });
        refreshContextUi(ctx);
        const insights = data.insights;
        if (insights) {
          ctx.ui.setWidget("qdash", (_tui, theme) => textComponent(wiringInsightLines(insights).slice(1, -1), theme, true));
          ctx.ui.notify(`QDash wiring insights updated: ${data.selection.resolved_cooldown_id}`, "info");
        } else {
          ctx.ui.setWidget("qdash", ["QDash Wiring Insights", "No markdown wiring table found"]);
          ctx.ui.notify("QDash wiring insights unavailable: no markdown table", "warning");
        }
      } catch (error) {
        ctx.ui.notify(`QDash wiring insights failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("qdash-dashboard", {
    description: "Show a compact QDash dashboard for the current context",
    handler: async (args, ctx) => {
      const limit = args.trim() ? Number(args.trim()) : undefined;
      const dashboard = await buildDashboard({ limit: Number.isFinite(limit) ? limit : undefined });
      refreshContextUi(ctx);
      ctx.ui.setWidget("qdash", (_tui, theme) => dashboardComponent(dashboard, theme));
      ctx.ui.notify(`QDash dashboard updated: ${dashboard.openIssues.count} open issues, ${dashboard.failedTaskResults.count} failed tasks`, "info");
    },
  });

  pi.registerCommand("qdash-refresh", {
    description: "Refresh the QDash dashboard widget for the current context",
    handler: async (args, ctx) => {
      const limit = args.trim() ? Number(args.trim()) : undefined;
      const dashboard = await buildDashboard({ limit: Number.isFinite(limit) ? limit : undefined });
      refreshContextUi(ctx);
      ctx.ui.setWidget("qdash", (_tui, theme) => dashboardComponent(dashboard, theme));
      ctx.ui.notify("QDash widget refreshed", "info");
    },
  });

  pi.registerCommand("qdash-context", {
    description: "Show the current QDash context",
    handler: async (_args, ctx) => {
      refreshContextUi(ctx);
      ctx.ui.setWidget("qdash", [
        "QDash Context",
        `profile ${currentContext.profile ?? "env/default"}`,
        `chip ${currentContext.chipId ?? "auto-chip"}`,
        `target ${currentContext.qid ? `q${currentContext.qid}` : currentContext.couplingId ? `c${currentContext.couplingId}` : "none"}`,
        `task ${currentContext.taskName ?? "none"}`,
        `last execution ${currentContext.lastExecutionId ?? "none"}`,
        `last task ${currentContext.lastTaskId ?? "none"}`,
        `agent session ${currentContext.agentSessionId ?? "none"}`,
      ]);
      ctx.ui.notify(contextSummary(), "info");
    },
  });

  pi.registerCommand("qdash-config", {
    description: "Show non-secret QDash config/profile information",
    handler: async (args, ctx) => {
      const profile = args.trim() || undefined;
      const profiles = configProfiles();
      try {
        const client = await makeClient({ profile });
        ctx.ui.setWidget("qdash", JSON.stringify({ profiles, active: safeConfig(client, profile ? `profile:${profile}` : shouldUseEnv({}) ? "env" : "profile:default") }, null, 2).split("\n"));
        ctx.ui.notify("QDash config shown in widget", "info");
      } catch (error) {
        ctx.ui.notify(`QDash config error: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    currentContext = loadGlobalContext();
    for (const entry of ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>) {
      if (entry.type === "custom" && entry.customType === CONTEXT_ENTRY_TYPE && isQDashContextState(entry.data)) {
        currentContext = { ...entry.data };
      }
    }
    try {
      if (await ensureActiveChip()) persistContext();
    } catch {
      // Leave chip as auto when no QDash connection/profile is available at startup.
    }
    refreshContextUi(ctx);
  });
}
