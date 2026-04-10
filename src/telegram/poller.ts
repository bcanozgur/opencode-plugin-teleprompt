import type { ParsedTelegramCommand, TelegramUpdate } from "../types.js";
import { parseTelegramUpdate } from "./parser.js";
import { TelegramApi } from "./api.js";

type PollerHandlers = {
  onCommand: (command: ParsedTelegramCommand) => Promise<void>;
  onOffset: (offset: number) => Promise<void>;
  onError: (error: unknown) => void;
};

export class TelegramPoller {
  constructor(
    private readonly api: TelegramApi,
    private readonly channelID: string,
    private readonly prefix: string,
    private readonly timeoutSec: number,
    private readonly handlers: PollerHandlers,
  ) {}

  async run(startOffset: number, signal: AbortSignal): Promise<void> {
    let offset = startOffset;
    while (!signal.aborted) {
      try {
        const updates = await this.api.getUpdates(offset, this.timeoutSec, signal);
        if (signal.aborted) break;
        offset = await this.processUpdates(offset, updates);
      } catch (error) {
        if (signal.aborted) break;
        this.handlers.onError(error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async processUpdates(
    offset: number,
    updates: TelegramUpdate[],
  ): Promise<number> {
    let nextOffset = offset;
    for (const update of updates) {
      const parsed = parseTelegramUpdate(update, this.channelID, this.prefix);
      const candidateOffset = Math.max(nextOffset, update.update_id + 1);
      if (!parsed) {
        nextOffset = candidateOffset;
        await this.handlers.onOffset(nextOffset);
        continue;
      }
      // Persist offset only after command handling succeeds, so failed commands are retried.
      await this.handlers.onCommand(parsed);
      nextOffset = candidateOffset;
      await this.handlers.onOffset(nextOffset);
    }
    return nextOffset;
  }
}
