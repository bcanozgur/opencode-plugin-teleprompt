import type {
  ParsedCallbackQuery,
  ParsedTelegramCommand,
  TelegramCallbackQuery,
  TelegramChannelPost,
  TelegramCommand,
  TelegramUpdate,
} from "../types.js";
import {
  decodeCallbackData,
  decodeTextQuestionReject,
  decodeTextQuestionReply,
} from "./callback.js";

function parseCommandBody(body: string): TelegramCommand | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;

  const statusMatch = /^status\s*$/i.exec(trimmed);
  if (statusMatch) return { kind: "status" };

  const interruptMatch = /^interrupt\s*$/i.exec(trimmed);
  if (interruptMatch) return { kind: "interrupt" };

  const queueMatch = /^queue\s*$/i.exec(trimmed);
  if (queueMatch) return { kind: "queue" };

  const retryMatch = /^retry\s*$/i.exec(trimmed);
  if (retryMatch) return { kind: "retry" };

  const contextMatch = /^context\s*$/i.exec(trimmed);
  if (contextMatch) return { kind: "context" };

  const compactMatch = /^compact\s*$/i.exec(trimmed);
  if (compactMatch) return { kind: "compact" };

  const newSessionMatch = /^(newsession|new-session)\s*$/i.exec(trimmed);
  if (newSessionMatch) return { kind: "newsession" };

  const resetContextMatch = /^reset-context\s*$/i.exec(trimmed);
  if (resetContextMatch) return { kind: "reset-context" };

  const whoMatch = /^who\s*$/i.exec(trimmed);
  if (whoMatch) return { kind: "who" };

  const healthMatch = /^health\s*$/i.exec(trimmed);
  if (healthMatch) return { kind: "health" };

  const reclaimMatch = /^reclaim\s*$/i.exec(trimmed);
  if (reclaimMatch) return { kind: "reclaim" };

  const historyMatch = /^history\s*$/i.exec(trimmed);
  if (historyMatch) return { kind: "history" };

  const lastErrorMatch = /^last-error\s*$/i.exec(trimmed);
  if (lastErrorMatch) return { kind: "last-error" };

  const diagMatch = /^diag(nostic)?\s*$/i.exec(trimmed);
  if (diagMatch) return { kind: "diag" };

  const versionMatch = /^version\s*$/i.exec(trimmed);
  if (versionMatch) return { kind: "version" };

  const dcMatch = /^(dc|disconnect)\s*$/i.exec(trimmed);
  if (dcMatch) return { kind: "disconnect" };

  const cancelMatch = /^cancel\s+([A-Za-z0-9_\-:.]+)\s*$/i.exec(trimmed);
  if (cancelMatch) return { kind: "cancel", target: cancelMatch[1] };

  const approveMatch = /^approve\s+([A-Za-z0-9_\-:.]+)\s*$/i.exec(trimmed);
  if (approveMatch) {
    return { kind: "permission", action: "once", requestID: approveMatch[1] };
  }
  const approveAlwaysMatch =
    /^approve-always\s+([A-Za-z0-9_\-:.]+)\s*$/i.exec(trimmed);
  if (approveAlwaysMatch) {
    return {
      kind: "permission",
      action: "always",
      requestID: approveAlwaysMatch[1],
    };
  }
  const denyMatch = /^deny\s+([A-Za-z0-9_\-:.]+)\s*$/i.exec(trimmed);
  if (denyMatch) {
    return { kind: "permission", action: "reject", requestID: denyMatch[1] };
  }

  const qreplyMatch = /^qreply\s+([A-Za-z0-9_\-:.]+)/i.exec(trimmed);
  if (qreplyMatch) {
    const decoded = decodeTextQuestionReply(trimmed);
    if (decoded && decoded.requestID === qreplyMatch[1]) {
      return {
        kind: "question",
        action: "reply",
        requestID: decoded.requestID,
        answers: decoded.answers,
      };
    }
  }

  const ansMatch = /^ans(wer)?\s+([A-Za-z0-9_\-:.]+)\s+(.+)$/i.exec(trimmed);
  if (ansMatch) {
    const requestID = ansMatch[2];
    const rawAnswer = ansMatch[3].trim();
    // Support "0:Option" or "Option" format
    const qIndexMatch = /^(\d+):(.+)$/.exec(rawAnswer);
    const questionIndex = qIndexMatch ? Number(qIndexMatch[1]) : 0;
    const label = qIndexMatch ? qIndexMatch[2].trim() : rawAnswer;
    return {
      kind: "question",
      action: "reply",
      requestID,
      answers: [{ questionIndex, labels: [label] }],
    };
  }

  const qrejectMatch = /^qreject\s+([A-Za-z0-9_\-:.]+)\s*$/i.exec(trimmed);

  const skipMatch = /^skip\s+([A-Za-z0-9_\-:.]+)\s*$/i.exec(trimmed);
  if (skipMatch) {
    return { kind: "question", action: "reject", requestID: skipMatch[1] };
  }
  if (qrejectMatch) {
    const decoded = decodeTextQuestionReject(trimmed);
    if (decoded) {
      return {
        kind: "question",
        action: "reject",
        requestID: decoded.requestID,
      };
    }
  }

  const modelMatch = /^model(?:\s+([A-Za-z0-9_./-]+))?\s*$/i.exec(trimmed);
  if (modelMatch) {
    const rawTarget = modelMatch[1]?.trim();
    if (!rawTarget) {
      return { kind: "model" };
    }
    const preset = rawTarget.toLowerCase();
    if (preset === "fast" || preset === "smart" || preset === "max") {
      return { kind: "model", preset };
    }
    const providerModel = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.:-]+)$/.exec(rawTarget);
    if (providerModel) {
      return {
        kind: "model",
        target: {
          providerID: providerModel[1],
          modelID: providerModel[2],
        },
      };
    }
  }

  return { kind: "prompt", prompt: trimmed };
}

export function parseTelegramUpdate(
  update: TelegramUpdate,
  channelID: string,
  prefix: string,
): ParsedTelegramCommand | ParsedCallbackQuery | undefined {
  if (update.callback_query) {
    return parseCallbackQuery(update, channelID);
  }
  return parseChannelPost(update, channelID, prefix);
}

function parseChannelPost(
  update: TelegramUpdate,
  channelID: string,
  prefix: string,
): ParsedTelegramCommand | undefined {
  const post = update.channel_post || update.message;
  if (!post) return undefined;

  const normalizedChannel = String(post.chat.id);
  if (normalizedChannel !== channelID) return undefined;

  const text = post.text?.trim();
  if (!text) return undefined;

  // 1. Direct Prompts (Non-slash messages)
  if (!text.startsWith("/")) {
    return {
      updateID: update.update_id,
      messageID: post.message_id,
      channelID: normalizedChannel,
      rawText: text,
      command: { kind: "prompt", prompt: text },
    };
  }

  // 2. Backward compatibility: Handle "/tp:" commands
  if (text.startsWith(`${prefix}:`)) {
    const remainder = text.slice(`${prefix}:`.length).trim();
    const command = parseCommandBody(remainder);
    if (!command) return undefined;
    return {
      updateID: update.update_id,
      messageID: post.message_id,
      channelID: normalizedChannel,
      rawText: text,
      command,
    };
  }

  // 3. Backward compatibility: Handle "/tp " commands/prompts
  if (text.startsWith(`${prefix} `)) {
    const remainder = text.slice(`${prefix} `.length).trim();
    const command = parseCommandBody(remainder);
    if (!command) return undefined;
    return {
      updateID: update.update_id,
      messageID: post.message_id,
      channelID: normalizedChannel,
      rawText: text,
      command,
    };
  }

  // 4. Handle exact "/tp"
  if (text === prefix) {
    return undefined;
  }

  // 5. Handle direct slash commands, e.g., "/status", "/approve <id>"
  if (text.startsWith("/")) {
    const remainder = text.slice(1).trim();
    const command = parseCommandBody(remainder);
    // Only accept if it is a real command and NOT fallback prompt
    if (command && command.kind !== "prompt") {
      return {
        updateID: update.update_id,
        messageID: post.message_id,
        channelID: normalizedChannel,
        rawText: text,
        command,
      };
    }
  }

  return undefined;
}

function parseCallbackQuery(
  update: TelegramUpdate,
  channelID: string,
): ParsedCallbackQuery | undefined {
  const query = update.callback_query;
  if (!query) return undefined;
  const message = query.message;
  if (!message) return undefined;
  const normalizedChannel = String(message.chat.id);
  if (normalizedChannel !== channelID) return undefined;
  const data = query.data;
  if (!data) return undefined;

  const decoded = decodeCallbackData(data);
  if (decoded.kind === "unknown") return undefined;

  let command: TelegramCommand | undefined;
  if (decoded.kind === "permission") {
    command = {
      kind: "permission",
      action: decoded.action,
      requestID: decoded.requestID,
    };
  } else if (decoded.kind === "question") {
    if (decoded.action === "reject") {
      command = {
        kind: "question",
        action: "reject",
        requestID: decoded.requestID,
      };
    } else if (decoded.action === "answer") {
      // Single-choice: will be resolved to a full answer by the controller
      // using the pending question's option labels. We pass the indices.
      command = {
        kind: "question",
        action: "reply",
        requestID: decoded.requestID,
        questionIndex: decoded.questionIndex,
        optionIndex: decoded.optionIndex,
      };
    } else if (decoded.action === "toggle") {
      command = {
        kind: "question",
        action: "toggle",
        requestID: decoded.requestID,
        questionIndex: decoded.questionIndex,
        optionIndex: decoded.optionIndex,
      };
    } else if (decoded.action === "confirm") {
      command = {
        kind: "question",
        action: "confirm",
        requestID: decoded.requestID,
        questionIndex: decoded.questionIndex,
      };
    }
  }

  if (!command) return undefined;

  return {
    updateID: update.update_id,
    callbackQueryID: query.id,
    channelID: normalizedChannel,
    messageID: message.message_id,
    rawData: data,
    command,
  };
}

export function isChannelPostFromTarget(
  post: TelegramChannelPost | undefined,
  channelID: string,
): boolean {
  if (!post) return false;
  return String(post.chat.id) === channelID;
}

export function isCallbackFromTarget(
  query: TelegramCallbackQuery | undefined,
  channelID: string,
): boolean {
  if (!query) return false;
  return String(query.message?.chat.id ?? "") === channelID;
}
