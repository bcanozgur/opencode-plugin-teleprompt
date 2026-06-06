import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BridgeStoreData, PendingQuestion, PendingQuestionAnswer } from "../types.js";

function createDefaultStore(channelID: string): BridgeStoreData {
  return {
    version: 1,
    pollingOffset: 0,
    bound: {
      channelID,
      status: "offline",
    },
    promptQueue: [],
    pendingPermissions: {},
    pendingQuestions: {},
    questionAnswers: {},
    promptHistory: [],
    recentPrompts: [],
    updatedAt: Date.now(),
  };
}

function coerceQuestionMap(
  raw: unknown,
): Record<string, PendingQuestion> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, PendingQuestion> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const item = value as Partial<PendingQuestion>;
    if (typeof item.requestID !== "string") continue;
    if (typeof item.sessionID !== "string") continue;
    if (!Array.isArray(item.questions)) continue;
    out[key] = {
      requestID: item.requestID,
      sessionID: item.sessionID,
      questions: item.questions,
      tool: item.tool,
      announcedAt: typeof item.announcedAt === "number" ? item.announcedAt : Date.now(),
    };
  }
  return out;
}

function coerceAnswerMap(
  raw: unknown,
): Record<string, PendingQuestionAnswer[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, PendingQuestionAnswer[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    out[key] = value
      .map((entry) => {
        if (!entry || typeof entry !== "object") return undefined;
        const item = entry as { questionIndex?: number; labels?: unknown };
        if (typeof item.questionIndex !== "number") return undefined;
        if (!Array.isArray(item.labels)) return undefined;
        const labels = item.labels.filter(
          (label): label is string => typeof label === "string",
        );
        return { questionIndex: item.questionIndex, labels };
      })
      .filter((entry): entry is PendingQuestionAnswer => Boolean(entry));
  }
  return out;
}

export class BridgeStore {
  constructor(
    private readonly filePath: string,
    private channelID: string,
  ) {}

  setChannelID(channelID: string): void {
    this.channelID = channelID;
  }

  async load(): Promise<BridgeStoreData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as BridgeStoreData;
      if (parsed.version !== 1) return createDefaultStore(this.channelID);
      return {
        ...parsed,
        bound: {
          ...parsed.bound,
          channelID: this.channelID,
        },
        promptHistory: Array.isArray(parsed.promptHistory) ? parsed.promptHistory : [],
        recentPrompts: Array.isArray(parsed.recentPrompts) ? parsed.recentPrompts : [],
        pendingPermissions: parsed.pendingPermissions ?? {},
        pendingQuestions: coerceQuestionMap(parsed.pendingQuestions),
        questionAnswers: coerceAnswerMap(parsed.questionAnswers),
      };
    } catch {
      return createDefaultStore(this.channelID);
    }
  }

  async save(next: BridgeStoreData): Promise<void> {
    const dir = dirname(this.filePath);
    const tempPath = `${this.filePath}.tmp`;
    await mkdir(dir, { recursive: true });
    await writeFile(
      tempPath,
      JSON.stringify(
        {
          ...next,
          updatedAt: Date.now(),
        },
        null,
        2,
      ),
      "utf8",
    );
    await rename(tempPath, this.filePath);
  }
}
