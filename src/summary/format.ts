import type { SummaryPayload } from "../types.js";

function trimTo(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

export function formatSummaryForTelegram(
  payload: SummaryPayload,
  maxChars: number,
): string {
  const lines: string[] = [];
  lines.push(payload.hadError ? "OpenCode result: error" : "OpenCode result:");
  lines.push(trimTo(payload.text || "(no assistant text)", maxChars));
  if (payload.changedFiles.length > 0) {
    lines.push("");
    lines.push("Changed files:");
    for (const file of payload.changedFiles.slice(0, 20)) {
      lines.push(`- ${file}`);
    }
  }
  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;
  return trimTo(joined, maxChars);
}

