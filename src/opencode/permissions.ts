import type {
  PendingPermission,
  PermissionAskInput,
  PendingQuestion,
  PendingQuestionAnswer,
  QuestionInfo,
  QuestionAskInput,
} from "../types.js";

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

export function toPendingQuestion(input: QuestionAskInput): PendingQuestion {
  return {
    requestID: input.id,
    sessionID: input.sessionID,
    questions: input.questions,
    tool: input.tool,
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

export function formatQuestionRequestMessage(
  question: PendingQuestion,
  questionIndex: number = 0,
): string {
  const info = question.questions[questionIndex];
  if (!info) {
    return [
      "OpenCode asked a question:",
      `request_id: ${question.requestID}`,
      `session_id: ${question.sessionID}`,
    ].join("\n");
  }
  const lines: string[] = [];
  lines.push("OpenCode asks:");
  if (info.header) lines.push(`[${info.header}]`);
  lines.push(info.question);
  lines.push("");
  lines.push("Options:");
  for (let i = 0; i < info.options.length; i++) {
    const opt = info.options[i];
    lines.push(`${i + 1}. ${opt.label}${opt.description ? ` — ${opt.description}` : ""}`);
  }
  if (info.custom) {
    lines.push("");
    lines.push("(Custom answer allowed by the agent — use the buttons or send /qreply with explicit labels.)");
  }
  if (question.questions.length > 1) {
    lines.push("");
    lines.push(`Question ${questionIndex + 1} of ${question.questions.length}.`);
  }
  lines.push("");
  lines.push(`Reply with: /ans ${question.requestID} <option>`);
  lines.push(`  e.g., /ans ${question.requestID} ${info.options[0]?.label ?? "option"}`);
  lines.push(`Skip: /skip ${question.requestID}`);
  return lines.join("\n");
}

export function getQuestionIndex(
  question: PendingQuestion,
  index: number,
): QuestionInfo | undefined {
  return question.questions[index];
}

export function normalizeAnswers(
  question: PendingQuestion,
  answers: PendingQuestionAnswer[],
): Array<string[]> {
  return question.questions.map((info, idx) => {
    const provided = answers.find((a) => a.questionIndex === idx);
    if (!provided) return [];
    const knownLabels = new Set(info.options.map((o) => o.label));
    return provided.labels.filter((label) => knownLabels.has(label));
  });
}

export async function replyPermission(
  client: any,
  sessionID: string,
  requestID: string,
  action: "once" | "always" | "reject",
  directory: string,
): Promise<void> {
  const reply = action;
  if (client?.permission?.reply) {
    await client.permission.reply(
      {
        requestID,
        directory,
        reply,
      },
      { responseStyle: "data", throwOnError: true },
    );
    return;
  }
  const fn =
    client.postSessionIdPermissionsPermissionId ??
    client.postSessionSessionIDPermissionsPermissionID ??
    client.postSessionByIdPermissionsByPermissionId;
  if (!fn) {
    throw new Error("OpenCode SDK client has no permission reply method.");
  }
  const response = action === "once" ? "once" : action === "always" ? "always" : "reject";
  await fn.call(client,
    {
      path: { id: sessionID, permissionID: requestID },
      body: { response },
    },
    { responseStyle: "data", throwOnError: true },
  );
}

export async function replyQuestion(
  client: any,
  directory: string,
  requestID: string,
  answers: Array<string[]>,
): Promise<void> {
  if (client?.question?.reply) {
    await client.question.reply(
      {
        requestID,
        directory,
        answers,
      },
      { responseStyle: "data", throwOnError: true },
    );
    return;
  }
  throw new Error("OpenCode SDK client has no question reply method.");
}

export async function rejectQuestion(
  client: any,
  directory: string,
  requestID: string,
): Promise<void> {
  if (client?.question?.reject) {
    await client.question.reject(
      {
        requestID,
        directory,
      },
      { responseStyle: "data", throwOnError: true },
    );
    return;
  }
  throw new Error("OpenCode SDK client has no question reject method.");
}
