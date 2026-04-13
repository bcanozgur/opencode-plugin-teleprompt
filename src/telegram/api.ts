import type { TelegramUpdate } from "../types.js";

type TelegramApiResult<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type GetUpdatesResult = TelegramUpdate[];
type SendMessageOptions = {
  replyToMessageID?: number;
};

export class TelegramApi {
  private readonly baseURL: string;
  private readonly maxMessageLen = 3500;

  constructor(private readonly token: string) {
    this.baseURL = `https://api.telegram.org/bot${token}`;
  }

  async getUpdates(
    offset: number,
    timeoutSec: number,
    signal?: AbortSignal,
  ): Promise<GetUpdatesResult> {
    const payload = {
      offset,
      timeout: timeoutSec,
    };
    const response = await this.post<GetUpdatesResult>(
      "/getUpdates",
      payload,
      signal,
    );
    return response;
  }

  async getLatestUpdateOffset(signal?: AbortSignal): Promise<number | undefined> {
    const updates = await this.getUpdates(-1, 0, signal);
    if (updates.length === 0) return undefined;
    const latest = updates.reduce((max, update) => Math.max(max, update.update_id), 0);
    return latest + 1;
  }

  async sendMessage(
    channelID: string,
    text: string,
    options?: SendMessageOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    const chunks = this.chunkText(text);
    for (const [index, chunk] of chunks.entries()) {
      await this.post(
        "/sendMessage",
        {
          chat_id: channelID,
          text: chunk,
          disable_web_page_preview: true,
          ...(index === 0 && options?.replyToMessageID
            ? {
              reply_to_message_id: options.replyToMessageID,
            }
            : {}),
        },
        signal,
      );
    }
  }

  private chunkText(text: string): string[] {
    if (text.length <= this.maxMessageLen) return [text];
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > this.maxMessageLen) {
      const splitAt = rest.lastIndexOf("\n", this.maxMessageLen);
      const idx = splitAt > 0 ? splitAt : this.maxMessageLen;
      chunks.push(rest.slice(0, idx));
      rest = rest.slice(idx).trimStart();
    }
    if (rest.length > 0) chunks.push(rest);
    return chunks;
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const res = await fetch(`${this.baseURL}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        throw new Error(`Telegram API HTTP ${res.status}`);
      }
      const json = (await res.json()) as TelegramApiResult<T>;
      if (!json.ok || json.result === undefined) {
        throw new Error(json.description || "Telegram API request failed");
      }
      return json.result;
    };

    try {
      return await run();
    } catch (error) {
      if (signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800));
      return run();
    }
  }
}
