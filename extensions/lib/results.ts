export function redact(value: unknown): unknown {
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

export function toToolResult(data: unknown, details: Record<string, unknown> = {}) {
  const safeData = redact(data);
  let text = JSON.stringify(safeData, null, 2);
  if (text.length > 20_000) text = `${text.slice(0, 20_000)}\n... [truncated]`;
  return {
    content: [{ type: "text" as const, text }],
    details: { ...details, data: safeData },
  };
}

export function toTextToolResult(text: string, data: unknown, details: Record<string, unknown> = {}) {
  const safeData = redact(data);
  return {
    content: [{ type: "text" as const, text }],
    details: { ...details, data: safeData },
  };
}
