import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BridgeStoreData } from "../types.js";

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
    promptHistory: [],
    recentPrompts: [],
    updatedAt: Date.now(),
  };
}

export class BridgeStore {
  constructor(
    private readonly filePath: string,
    private readonly channelID: string,
  ) {}

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
