import type { PendingPermission, PermissionAskInput } from "../types.js";

export function toPendingPermission(input: PermissionAskInput): PendingPermission {
  return {
    requestID: input.id,
    sessionID: input.sessionID,
    permission: input.permission,
    patterns: input.patterns,
    metadata: input.metadata,
    announcedAt: Date.now(),
  };
}

export function formatPermissionRequestMessage(
  prefix: string,
  permission: PendingPermission,
): string {
  const toolType =
    typeof permission.metadata?.tool === "string"
      ? permission.metadata.tool
      : typeof permission.metadata?.toolName === "string"
        ? permission.metadata.toolName
        : "unknown";
  const risk = classifyRisk(permission.permission, permission.metadata);
  const target = permission.patterns[0] || "(none)";
  const patterns =
    permission.patterns.length > 0
      ? permission.patterns.map((v) => `- ${v}`).join("\n")
      : "- (none)";
  return [
    "OpenCode permission request:",
    `request_id: ${permission.requestID}`,
    `session_id: ${permission.sessionID}`,
    `tool: ${toolType}`,
    `permission: ${permission.permission}`,
    `risk: ${risk}`,
    `target: ${target}`,
    "patterns:",
    patterns,
    "",
    "Reply examples:",
    `- Approve once: /approve ${permission.requestID}`,
    `- Approve always: /approve-always ${permission.requestID}`,
    `- Deny: /deny ${permission.requestID}`,
  ].join("\n");

}

function classifyRisk(
  permission: string,
  metadata: Record<string, unknown>,
): "read" | "write" | "exec" | "network" {
  const merged = `${permission} ${JSON.stringify(metadata)}`.toLowerCase();
  if (
    merged.includes("exec") ||
    merged.includes("shell") ||
    merged.includes("command")
  ) {
    return "exec";
  }
  if (
    merged.includes("network") ||
    merged.includes("http") ||
    merged.includes("fetch") ||
    merged.includes("url")
  ) {
    return "network";
  }
  if (
    merged.includes("write") ||
    merged.includes("delete") ||
    merged.includes("modify") ||
    merged.includes("create")
  ) {
    return "write";
  }
  return "read";
}

export async function replyPermission(
  client: any,
  sessionID: string,
  requestID: string,
  action: "once" | "always" | "reject",
): Promise<void> {
  // Bundled SDK convention: (params, options)
  // Try the bundled method name first, fall back to workspace SDK name
  const response = action === "once" ? "once" : action === "always" ? "always" : "reject";
  const fn =
    client.postSessionSessionIDPermissionsPermissionID ??
    client.postSessionIdPermissionsPermissionId ??
    client.postSessionByIdPermissionsByPermissionId;
  if (fn) {
    await fn.call(client,
      { sessionID, permissionID: requestID, response },
      { responseStyle: "data", throwOnError: true },
    );
  }
}
