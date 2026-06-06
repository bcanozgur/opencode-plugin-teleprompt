import type {
  ParsedCallbackQuery,
  ParsedTelegramCommand,
  TelegramUpdate,
} from "../types.js";
import { parseTelegramUpdate } from "./parser.js";
import { TelegramApi } from "./api.js";
import { delayWithSignal } from "./delay.js";


type BridgeCommand = ParsedTelegramCommand | ParsedCallbackQuery;

type PollerHandlers = {
  onCommand: (command: BridgeCommand) => Promise<void>;
  onOffset: (offset: number) => Promise<void>;
  onError: (error: unknown) => void;
  onUpdates?: (count: number) => void;
  onLog?: (message: string) => void;
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
    this.handlers.onLog?.(`poller: run starting at offset=${offset} timeout=${this.timeoutSec}s`);
    while (!signal.aborted) {
      try {
        this.handlers.onLog?.(`poller: getUpdates(offset=${offset})`);
        const updates = await this.api.getUpdates(offset, this.timeoutSec, signal);
        this.handlers.onLog?.(`poller: getUpdates returned ${updates.length} updates`);
        if (signal.aborted) break;
        if (updates.length > 0) {
          this.handlers.onUpdates?.(updates.length);
        }
        offset = await this.processUpdates(offset, updates);
      } catch (error) {
        if (signal.aborted) break;
        this.handlers.onLog?.(`poller: getUpdates threw: ${String(error)}`);
        this.handlers.onError(error);
        await delayWithSignal(1000, signal);
      }

    }
    this.handlers.onLog?.("poller: run exiting");
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
        const cq = update.callback_query;
        if (cq) {
          const chatId = cq.message?.chat.id;
          this.handlers.onLog?.(`poller: ignored callback_query id=${cq.id} chatId=${chatId} (expected ${this.channelID}) data=${cq.data}`);
        } else if (update.channel_post || update.message) {
          const post = (update.channel_post || update.message)!;
          const chatId = post.chat.id;
          const text = post.text || "";
          if (text.trim().startsWith(this.prefix) || text.trim().startsWith("/")) {
            this.handlers.onError(
              new Error(
                `Update ignored. Chat ID: ${chatId} (expected ${this.channelID}), Text: "${text}"`,
              ),
            );
          }
        } else {
          this.handlers.onLog?.(`poller: ignored update id=${update.update_id} type=${Object.keys(update).filter(k => k !== 'update_id').join(",")}`);
        }
        nextOffset = candidateOffset;
        await this.handlers.onOffset(nextOffset);
        continue;
      }
      // Save offset immediately, then fire-and-forget the command handler.
      // This prevents the poller from being blocked while a long-running
      // command (e.g. prompt processing) completes. Errors are caught and
      // forwarded to the error handler.
      nextOffset = candidateOffset;
      await this.handlers.onOffset(nextOffset);
      this.handlers.onCommand(parsed).catch((err) => {
        this.handlers.onError(err);
      });
    }
    return nextOffset;
  }
}
