import type {
  PendingQuestionAnswer,
  TelegramInlineKeyboardButton,
  TelegramInlineKeyboardMarkup,
} from "../types.js";

export const TELEGRAM_CALLBACK_DATA_MAX = 64;

export const PERMISSION_CALLBACK_PREFIX = "p";
export const QUESTION_CALLBACK_PREFIX = "q";

const PERMISSION_ACTION = {
  once: "o",
  always: "a",
  reject: "r",
} as const;

const QUESTION_ACTION = {
  answer: "a",
  reject: "r",
  toggle: "t",
  confirm: "c",
} as const;

export function encodePermissionCallback(
  action: "once" | "always" | "reject",
  requestID: string,
): string {
  return `${PERMISSION_CALLBACK_PREFIX}:${PERMISSION_ACTION[action]}:${requestID}`;
}

export function encodeQuestionReject(requestID: string): string {
  return `${QUESTION_CALLBACK_PREFIX}:${QUESTION_ACTION.reject}:${requestID}`;
}

export function encodeQuestionAnswer(
  requestID: string,
  questionIndex: number,
  optionIndex: number,
): string {
  return `${QUESTION_CALLBACK_PREFIX}:${QUESTION_ACTION.answer}:${requestID}:${questionIndex}:${optionIndex}`;
}

export function encodeQuestionToggle(
  requestID: string,
  questionIndex: number,
  optionIndex: number,
): string {
  return `${QUESTION_CALLBACK_PREFIX}:${QUESTION_ACTION.toggle}:${requestID}:${questionIndex}:${optionIndex}`;
}

export function encodeQuestionConfirm(
  requestID: string,
  questionIndex: number,
): string {
  return `${QUESTION_CALLBACK_PREFIX}:${QUESTION_ACTION.confirm}:${requestID}:${questionIndex}`;
}

type PermissionCallback = {
  kind: "permission";
  action: "once" | "always" | "reject";
  requestID: string;
};

type QuestionCallback = {
  kind: "question";
  action: "answer" | "reject" | "toggle" | "confirm";
  requestID: string;
  questionIndex?: number;
  optionIndex?: number;
};

export type DecodedCallback =
  | PermissionCallback
  | QuestionCallback
  | { kind: "unknown"; raw: string };

export function decodeCallbackData(raw: string): DecodedCallback {
  const parts = raw.split(":");
  const head = parts[0];
  if (head === PERMISSION_CALLBACK_PREFIX && parts.length === 3) {
    const actionCode = parts[1];
    const requestID = parts[2];
    if (actionCode === PERMISSION_ACTION.once) {
      return { kind: "permission", action: "once", requestID };
    }
    if (actionCode === PERMISSION_ACTION.always) {
      return { kind: "permission", action: "always", requestID };
    }
    if (actionCode === PERMISSION_ACTION.reject) {
      return { kind: "permission", action: "reject", requestID };
    }
  }
  if (head === QUESTION_CALLBACK_PREFIX) {
    const actionCode = parts[1];
    const requestID = parts[2];
    if (actionCode === QUESTION_ACTION.reject && parts.length === 3) {
      return { kind: "question", action: "reject", requestID };
    }
    if (
      actionCode === QUESTION_ACTION.answer &&
      parts.length === 5 &&
      requestID
    ) {
      return {
        kind: "question",
        action: "answer",
        requestID,
        questionIndex: Number(parts[3]),
        optionIndex: Number(parts[4]),
      };
    }
    if (
      actionCode === QUESTION_ACTION.toggle &&
      parts.length === 5 &&
      requestID
    ) {
      return {
        kind: "question",
        action: "toggle",
        requestID,
        questionIndex: Number(parts[3]),
        optionIndex: Number(parts[4]),
      };
    }
    if (
      actionCode === QUESTION_ACTION.confirm &&
      parts.length === 4 &&
      requestID
    ) {
      return {
        kind: "question",
        action: "confirm",
        requestID,
        questionIndex: Number(parts[3]),
      };
    }
  }
  return { kind: "unknown", raw };
}

export function buildPermissionKeyboard(
  requestID: string,
): TelegramInlineKeyboardMarkup {
  const row: TelegramInlineKeyboardButton[] = [
    {
      text: "Approve once",
      callback_data: encodePermissionCallback("once", requestID),
    },
    {
      text: "Approve always",
      callback_data: encodePermissionCallback("always", requestID),
    },
    {
      text: "Deny",
      callback_data: encodePermissionCallback("reject", requestID),
    },
  ];
  return { inline_keyboard: [row] };
}

export function buildQuestionKeyboard(input: {
  requestID: string;
  questionIndex: number;
  options: { label: string; description?: string }[];
  selectedLabels: string[];
  multiple: boolean;
}): TelegramInlineKeyboardMarkup {
  const { requestID, questionIndex, options, selectedLabels, multiple } = input;
  const buttons: TelegramInlineKeyboardButton[] = options.map((opt, idx) => {
    const isSelected = selectedLabels.includes(opt.label);
    const labelText = multiple
      ? `${isSelected ? "✅" : "▫️"} ${opt.label}`
      : opt.label;
    return {
      text: labelText,
      callback_data: multiple
        ? encodeQuestionToggle(requestID, questionIndex, idx)
        : encodeQuestionAnswer(requestID, questionIndex, idx),
    };
  });
  const rows: TelegramInlineKeyboardButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const slice = buttons.slice(i, i + 2);
    if (slice.length === 1) {
      rows.push(slice);
    } else {
      rows.push(slice);
    }
  }
  if (multiple) {
    const hasSelection = selectedLabels.length > 0;
    rows.push([
      {
        text: hasSelection
          ? `Confirm (${selectedLabels.length})`
          : "Select at least one",
        callback_data: encodeQuestionConfirm(requestID, questionIndex),
      },
      {
        text: "Skip / Reject",
        callback_data: encodeQuestionReject(requestID),
      },
    ]);
  } else {
    rows.push([
      {
        text: "Skip / Reject",
        callback_data: encodeQuestionReject(requestID),
      },
    ]);
  }
  return { inline_keyboard: rows };
}

export function encodeTextQuestionReply(
  requestID: string,
  answers: PendingQuestionAnswer[],
): string {
  const lines: string[] = [];
  lines.push(`/qreply ${requestID}`);
  for (let i = 0; i < answers.length; i++) {
    const ans = answers[i];
    const labels = ans.labels.join("|");
    lines.push(`${i}:${labels}`);
  }
  return lines.join("\n");
}

export function encodeTextQuestionReject(requestID: string): string {
  return `/qreject ${requestID}`;
}

export function decodeTextQuestionReply(
  text: string,
): { requestID: string; answers: PendingQuestionAnswer[] } | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  const header = lines[0].split(/\s+/);
  const head = header[0].startsWith("/") ? header[0].slice(1) : header[0];
  if (head !== "qreply" || !header[1]) return undefined;
  const requestID = header[1];
  const answers: PendingQuestionAnswer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [idxRaw, labelsRaw] = lines[i].split(":", 2);
    if (idxRaw === undefined || labelsRaw === undefined) continue;
    const idx = Number(idxRaw);
    if (!Number.isFinite(idx)) continue;
    const labels = labelsRaw.split("|").filter(Boolean);
    answers.push({ questionIndex: idx, labels });
  }
  return { requestID, answers };
}

export function decodeTextQuestionReject(
  text: string,
): { requestID: string } | undefined {
  const header = text.trim().split(/\s+/);
  const head = header[0].startsWith("/") ? header[0].slice(1) : header[0];
  if (head !== "qreject" || !header[1]) return undefined;
  return { requestID: header[1] };
}
