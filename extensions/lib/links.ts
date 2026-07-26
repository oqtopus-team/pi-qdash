import type { QDashClient } from "@oqtopus-team/qdash-client";

function firstString(object: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function qdashWebBaseUrl(client: QDashClient): string {
  return client.config.baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
}

export function qdashWebUrl(client: QDashClient, path: string): string {
  return `${qdashWebBaseUrl(client)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function qdashObjectLinks(client: QDashClient, object: Record<string, unknown>): Record<string, string> {
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

export function withQDashLinks(client: QDashClient, data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const object = data as Record<string, unknown>;
  const links = qdashObjectLinks(client, object);
  if (Object.keys(links).length === 0) return data;
  return { ...object, _links: links };
}

export function safeConfig(client: QDashClient, source: string) {
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
