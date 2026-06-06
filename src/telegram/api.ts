import type {
  TelegramInlineKeyboardMarkup,
  TelegramUpdate,
} from "../types.js";
import { delayWithSignal } from "./delay.js";

type TelegramApiResult<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type GetUpdatesResult = TelegramUpdate[];
type SendMessageOptions = {
  replyToMessageID?: number;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  disableWebPagePreview?: boolean;
};

export type TelegramPostFn = <T>(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<T>;

export class TelegramApi {
  private readonly baseURL: string;
  private readonly maxMessageLen = 3500;
  private readonly postFn: TelegramPostFn;

  constructor(
    private readonly token: string,
    options?: { postFn?: TelegramPostFn; fetchImpl?: typeof fetch },
  ) {
    this.baseURL = `https://api.telegram.org/bot${token}`;
    if (options?.postFn) {
      this.postFn = options.postFn;
    } else {
      const fetchImpl = options?.fetchImpl ?? fetch;
      this.postFn = <T>(
        path: string,
        body: Record<string, unknown>,
        signal?: AbortSignal,
      ): Promise<T> => this.defaultPost(path, body, signal, fetchImpl);
    }
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
    const response = await this.postFn<GetUpdatesResult>(
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
      await this.postFn(
        "/sendMessage",
        {
          chat_id: channelID,
          text: chunk,
          disable_web_page_preview:
            options?.disableWebPagePreview ?? true,
          ...(index === 0 && options?.replyToMessageID
            ? {
              reply_to_message_id: options.replyToMessageID,
            }
            : {}),
          ...(index === 0 && options?.replyMarkup
            ? {
              reply_markup: options.replyMarkup,
            }
            : {}),
        },
        signal,
      );
    }
  }

  async getChat(
    channelID: string,
    signal?: AbortSignal,
  ): Promise<{ type: string; title?: string }> {
    const result = await this.postFn<{ type: string; title?: string }>(
      "/getChat",
      { chat_id: channelID },
      signal,
    );
    return result;
  }

  async getChatMember(
    channelID: string,
    userID: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const result = await this.postFn<{ status: string; permissions?: Record<string, boolean> }>(
      "/getChatMember",
      { chat_id: channelID, user_id: userID },
      signal,
    );
    return result;
  }

  async getMe(signal?: AbortSignal): Promise<{ id: number; username?: string }> {
    const result = await this.postFn<{ id: number; username?: string }>(
      "/getMe",
      {},
      signal,
    );
    return result;
  }

  async getWebhookInfo(signal?: AbortSignal): Promise<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    max_connections?: number;
    last_error_date?: number;
    last_error_message?: string;
  }> {
    const result = await this.postFn<
      {
        url: string;
        has_custom_certificate: boolean;
        pending_update_count: number;
        max_connections?: number;
        last_error_date?: number;
        last_error_message?: string;
      }
    >("/getWebhookInfo", {}, signal);
    return result;
  }

  async answerCallbackQuery(
    callbackQueryID: string,
    options?: { text?: string; showAlert?: boolean },
    signal?: AbortSignal,
  ): Promise<void> {
    await this.postFn(
      "/answerCallbackQuery",
      {
        callback_query_id: callbackQueryID,
        ...(options?.text ? { text: options.text } : {}),
        ...(options?.showAlert ? { show_alert: true } : {}),
      },
      signal,
    );
  }

  async editMessageReplyMarkup(
    channelID: string,
    messageID: number,
    replyMarkup: TelegramInlineKeyboardMarkup | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.postFn(
      "/editMessageReplyMarkup",
      {
        chat_id: channelID,
        message_id: messageID,
        ...(replyMarkup ? { reply_markup: replyMarkup } : { reply_markup: { inline_keyboard: [] } }),
      },
      signal,
    );
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

  private async defaultPost<T>(
    path: string,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    fetchImpl: typeof fetch,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const res = await fetchImpl(`${this.baseURL}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
      let json: TelegramApiResult<T> | undefined;
      try {
        json = (await res.json()) as TelegramApiResult<T>;
      } catch {
        // ignore
      }

      if (!res.ok) {
        const desc = json?.description ? `: ${json.description}` : "";
        throw new Error(`Telegram API HTTP ${res.status}${desc}`);
      }
      if (!json || !json.ok || json.result === undefined) {
        throw new Error(json?.description || "Telegram API request failed");
      }
      return json.result;
    };

    try {
      return await run();
    } catch (error) {
      if (signal?.aborted) throw error;
      await delayWithSignal(800, signal);
      return run();
    }
  }
}
