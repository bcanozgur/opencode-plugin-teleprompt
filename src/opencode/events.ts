import type { QuestionInfo } from "../types.js";

type EventHandlers = {
  onAssistantCompleted: (
    sessionID: string,
    assistantMessageID: string,
    parentUserMessageID: string,
  ) => Promise<void>;
  onPermissionAsked: (event: {
    id: string;
    sessionID: string;
    permission: string;
    patterns: string[];
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  onPermissionReplied?: (requestID: string) => Promise<void>;
  onQuestionAsked?: (event: {
    id: string;
    sessionID: string;
    questions: QuestionInfo[];
    tool?: { messageID: string; callID: string };
  }) => Promise<void>;
  onQuestionReplied?: (event: { id: string; sessionID: string }) => Promise<void>;
  onQuestionRejected?: (event: { id: string; sessionID: string }) => Promise<void>;
  onSessionError: (event: { sessionID?: string; error?: { name?: string } }) => Promise<void>;
  onUserMessage: (sessionID: string, userMessageID: string) => Promise<void>;
  onMessagePartUpdated?: (input: {
    sessionID: string;
    messageID: string;
    part: { type: string; text?: string; [key: string]: unknown };
    delta?: string;
  }) => Promise<void>;
  onStreamError?: (error: unknown) => Promise<void>;
};

function normalizePatterns(pattern: string | Array<string> | undefined): string[] {
  if (!pattern) return [];
  if (Array.isArray(pattern)) return pattern;
  return [pattern];
}

function normalizeQuestions(
  raw: unknown,
): QuestionInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const item = entry as Record<string, unknown>;
      const question = typeof item.question === "string" ? item.question : "";
      const header = typeof item.header === "string" ? item.header : "";
      const rawOptions = Array.isArray(item.options) ? item.options : [];
      const options = rawOptions
        .map((opt): { label: string; description: string } | undefined => {
          if (!opt || typeof opt !== "object") return undefined;
          const o = opt as Record<string, unknown>;
          const label = typeof o.label === "string" ? o.label : "";
          if (!label) return undefined;
          const description = typeof o.description === "string" ? o.description : "";
          return { label, description };
        })
        .filter((opt): opt is { label: string; description: string } =>
          Boolean(opt),
        );
      if (!question) return undefined;
      const info: QuestionInfo = {
        question,
        header,
        options,
      };
      if (item.multiple === true) info.multiple = true;
      if (item.custom === true) info.custom = true;
      return info;
    })
    .filter((item): item is QuestionInfo => Boolean(item));
}

export class SessionEventStream {
  private abort = new AbortController();
  private running?: Promise<void>;
  private stream?: any;
  private pollTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly client: any,
    private readonly sessionID: string,
    private readonly directory: string,
    private readonly handlers: EventHandlers,
    private readonly debugLog?: (message: string) => void,
  ) {}

  /** Exposed for testing */
  __test?: {
    pollQuestionListOnce: () => Promise<void>;
    seenForwardedQuestionCalls: Set<string>;
  };

  start(): void {
    if (this.running) return;
    this.debugLog?.(`start: subscribing to event stream for sessionID=${this.sessionID}`);
    this.__test = {
      pollQuestionListOnce: () => this.pollQuestionListOnce(),
      seenForwardedQuestionCalls: this.seenForwardedQuestionCalls,
    };
    this.startQuestionPoller();
    this.running = this.loop().catch(async (error) => {
      if (this.abort.signal.aborted) return;
      this.debugLog?.(`loop error: ${String(error)}`);
      await this.handlers.onStreamError?.(error);
    });
  }

  async stop(): Promise<void> {
    this.abort.abort();
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    try {
      if (this.stream && typeof this.stream.return === "function") {
        await this.stream.return();
      }
    } catch {
      // ignore
    }
    await this.running;
    this.running = undefined;
  }

  private startQuestionPoller(): void {
    if (this.pollTimer) return;
    const poll = () => {
      this.pollTimer = setTimeout(async () => {
        if (this.abort.signal.aborted) return;
        try {
          await this.pollQuestionListOnce();
        } catch (err) {
          this.debugLog?.(`question poll timer error: ${String(err)}`);
        }
        if (!this.abort.signal.aborted) poll();
      }, 2000);
      this.pollTimer.unref?.();
    };
    poll();
  }

  private async pollQuestionListOnce(): Promise<void> {
    if (!this.client?.question?.list) {
      this.debugLog?.("poll: client.question.list is not available");
      return;
    }
    this.debugLog?.(`poll: checking question.list() [sessionID=${this.sessionID}]`);
    let result: any;
    try {
      result = await this.client.question.list();
    } catch (err: any) {
      this.debugLog?.(`poll: question.list() THREW: ${String(err)}`);
      return;
    }
    this.debugLog?.(`poll: question.list() returned type=${typeof result} isArray=${Array.isArray(result)}`);
    const raw = result as any;
    if (raw && typeof raw === "object") {
      const keys = Object.keys(raw);
      this.debugLog?.(`poll: result keys=[${keys.join(",")}]`);
      if (raw.data !== undefined) {
        this.debugLog?.(`poll: result.data type=${typeof raw.data} isArray=${Array.isArray(raw.data)} length=${Array.isArray(raw.data) ? raw.data.length : "N/A"}`);
      }
    }
    const items = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
    this.debugLog?.(`poll: extracted ${items.length} items`);
    if (items.length > 0) {
      for (const item of items) {
        this.debugLog?.(`poll: item id=${item.id} sessionID=${item.sessionID} matchSession=${item.sessionID === this.sessionID} alreadySeen=${this.seenForwardedQuestionCalls.has(item.id)}`);
      }
    }
    const match = items.find(
      (q: any) => q.sessionID === this.sessionID && !this.seenForwardedQuestionCalls.has(q.id),
    );
    if (!match) {
      this.debugLog?.("poll: no matching question found");
      return;
    }
    this.debugLog?.(`poll: match found id=${match.id} questionsRaw=${JSON.stringify(match.questions)}`);
    const questions = normalizeQuestions(match.questions);
    this.debugLog?.(`poll: normalized questions count=${questions.length}`);
    if (questions.length === 0) return;
    this.seenForwardedQuestionCalls.add(match.id);
    this.debugLog?.(
      `forward: question poll id=${match.id} sessionID=${this.sessionID} questions=${questions.length}`,
    );
    if (this.handlers.onQuestionAsked) {
      await this.handlers.onQuestionAsked({
        id: match.id,
        sessionID: this.sessionID,
        questions,
        tool: match.tool,
      });
    }
  }

  private async loop(): Promise<void> {
    this.debugLog?.(`subscribeGlobal: directory=${this.directory}`);
    // Prefer client.event.subscribe({directory}) — this delivers directory-scoped
    // events including permission.asked and question.asked.
    // Fall back to client.global.event() if subscribe is not available
    // (e.g., in tests with a fake client).
    let streamResult: any;
    if (typeof this.client?.event?.subscribe === "function") {
      this.debugLog?.("loop: using client.event.subscribe()");
      streamResult = await this.client.event.subscribe(
        { directory: this.directory },
        {
          responseStyle: "stream",
          throwOnError: true,
          signal: this.abort.signal,
          onSseError: (error: any) => {
            this.debugLog?.(`SSE error: ${String(error)}`);
          },
        },
      );
    } else if (typeof this.client?.global?.event === "function") {
      this.debugLog?.("loop: using client.global.event()");
      streamResult = await this.client.global.event({
        responseStyle: "stream",
        throwOnError: true,
        signal: this.abort.signal,
        onSseError: (error: any) => {
          this.debugLog?.(`SSE error: ${String(error)}`);
        },
      });
    } else {
      this.debugLog?.("loop: no event subscription method available");
    }
    this.stream = streamResult?.stream;
    if (!this.stream) {
      this.debugLog?.("loop: stream is undefined, skipping for-await");
      return;
    }
    try {
      for await (const chunk of this.stream as AsyncIterable<any>) {
        if (this.abort.signal.aborted) break;
        if (!chunk || typeof chunk !== "object") continue;
        // global.event() may return chunks in these shapes:
        //   { data: [{ directory, payload: { type, properties } }, ...] }
        //   [{ directory, payload: { type, properties } }, ...]
        //   { directory, payload: { type, properties } }
        // event.subscribe() returns events directly as { type, properties }
        const rawList: any[] = Array.isArray(chunk)
          ? chunk
          : Array.isArray((chunk as any).data)
            ? (chunk as any).data
            : (chunk as any).payload
              ? [chunk]
              : [chunk];
        for (const raw of rawList) {
          if (!raw || typeof raw !== "object") continue;
          const event: any = raw.payload
            ? { type: raw.payload.type, properties: raw.payload.properties, directory: raw.directory }
            : raw;
          if (!event.type) continue;
          // Filter by directory for global events (skip irrelevant ones)
          const dir = (event as any).directory;
          if (dir && dir !== this.directory && event.type !== "permission.asked" && event.type !== "question.asked" && event.type !== "question.replied" && event.type !== "question.rejected" && event.type !== "session.error") continue;
          this.debugLog?.(`event: type=${event.type} sessionID=${(event.properties as any)?.sessionID ?? "?"} id=${(event.properties as any)?.id ?? (event.properties as any)?.requestID ?? "?"}`);
          try {
            await this.handleEvent(event);
          } catch (handlerError) {
            // A misbehaving handler must never kill the entire event stream.
            this.debugLog?.(`handler error for type=${event.type}: ${String(handlerError)}`);
          }
        }
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        throw new Error("Event stream terminated unexpectedly.");
      }
    }
  }


  private async handleEvent(event: any): Promise<void> {
    if (this.debugLog) {
      try {
        const props = event?.properties;
        const summary = props
          ? Object.keys(props).slice(0, 6).map((k) => {
              const v = (props as any)[k];
              if (v && typeof v === "object") return `${k}=<obj:${Object.keys(v).slice(0, 4).join(",")}>`;
              return `${k}=${typeof v === "string" ? v.slice(0, 40) : String(v)}`;
            }).join(" ")
          : "<no-props>";
        this.debugLog(`event: type=${event.type} ${summary}`);
      } catch {}
    }
    if (event.type === "permission.asked" || event.type === "permission.updated") {
      const data = event.properties as {
        id: string;
        type?: string;
        permission?: string;
        pattern?: string | Array<string>;
        patterns?: string | Array<string>;
        sessionID: string;
        metadata?: Record<string, unknown>;
      };
      if (data.sessionID !== this.sessionID) {
        this.debugLog?.(`drop: permission.asked for sessionID=${data.sessionID} (bound=${this.sessionID})`);
        return;
      }
      await this.handlers.onPermissionAsked({
        id: data.id,
        sessionID: data.sessionID,
        permission: data.permission || data.type || "unknown",
        patterns: normalizePatterns(data.patterns || data.pattern),
        metadata: data.metadata ?? {},
      });
      return;
    }

    if (event.type === "permission.replied") {
      const data = event.properties as {
        sessionID: string;
        permissionID?: string;
        requestID?: string;
        response?: string;
        reply?: string;
      };
      if (data.sessionID !== this.sessionID) return;
      const id = data.requestID || data.permissionID;
      if (id) {
        await this.handlers.onPermissionReplied?.(id);
      }
      return;
    }

    if (event.type === "question.asked") {
      const data = event.properties as {
        id: string;
        sessionID: string;
        questions: unknown;
        tool?: { messageID: string; callID: string };
      };
      if (data.sessionID !== this.sessionID) {
        this.debugLog?.(`drop: question.asked for sessionID=${data.sessionID} (bound=${this.sessionID})`);
        return;
      }
      const questions = normalizeQuestions(data.questions);
      this.debugLog?.(`forward: question.asked id=${data.id} questions=${questions.length}`);
      if (!this.handlers.onQuestionAsked) return;
      await this.handlers.onQuestionAsked({
        id: data.id,
        sessionID: data.sessionID,
        questions,
        tool: data.tool,
      });
      return;
    }

    if (event.type === "question.replied") {
      const data = event.properties as {
        sessionID: string;
        requestID: string;
        answers: Array<Array<string>>;
      };
      if (data.sessionID !== this.sessionID) return;
      await this.handlers.onQuestionReplied?.({
        id: data.requestID,
        sessionID: data.sessionID,
      });
      return;
    }

    if (event.type === "question.rejected") {
      const data = event.properties as {
        sessionID: string;
        requestID: string;
      };
      if (data.sessionID !== this.sessionID) return;
      await this.handlers.onQuestionRejected?.({
        id: data.requestID,
        sessionID: data.sessionID,
      });
      return;
    }

    if (event.type === "session.error") {
      const data = event.properties as { sessionID?: string; error?: { name?: string } };
      if (data.sessionID && data.sessionID !== this.sessionID) return;
      await this.handlers.onSessionError(data);
      return;
    }

    if (event.type === "message.part.updated") {
      const data = event.properties as {
        part: { type: string; sessionID?: string; messageID?: string; text?: string; [key: string]: unknown };
        delta?: string;
      };
      const part = data.part;
      const partSessionID = part?.sessionID;
      const partMessageID = part?.messageID;
      this.debugLog?.(`msg.part.updated: type=${part?.type} id=${part?.id ?? "?"} msgID=${part?.messageID ?? "?"} sessionID=${partSessionID ?? "?"} keys=${part ? Object.keys(part).slice(0, 10).join(",") : "no-part"} delta=${data.delta?.slice(0, 40) ?? "?"}`);
      if (!partSessionID || partSessionID !== this.sessionID) return;
      if (!partMessageID) return;
      await this.handlers.onMessagePartUpdated?.({
        sessionID: partSessionID,
        messageID: partMessageID,
        part,
        delta: data.delta,
      });

      // OpenCode TUI surfaces questions as tool calls on the assistant message
      // (part.type === "tool", part.tool === "question", part.state.status
      // === "running"/"pending"). Bridge that into onQuestionAsked so the
      // Telegram inline keyboard fires.
      if (part && (part as any).type === "tool" && (part as any).tool === "question") {
        this.debugLog?.(`msg.part.updated: TOOL CALL detected! part.id=${(part as any).id} callID=${(part as any).callID ?? "?"} state=${JSON.stringify((part as any).state)}`);
        await this.handleQuestionToolPart(part as any);
      } else if (part && (part as any).type === "tool") {
        this.debugLog?.(`msg.part.updated: non-question tool call: tool=${(part as any).tool}`);
      }
      return;
    }

    if (event.type !== "message.updated") return;
    const data = event.properties as {
      sessionID: string;
      info: {
        id: string;
        role: string;
        time?: { completed?: number };
        parentID?: string;
      };
    };
    if (data.sessionID !== this.sessionID) return;
    if (data.info.role === "assistant") {
      if (!data.info.time?.completed || !data.info.parentID) return;
      await this.handlers.onAssistantCompleted(
        data.sessionID,
        data.info.id,
        data.info.parentID,
      );
      return;
    }
    if (data.info.role !== "user") return;
    await this.handlers.onUserMessage(data.sessionID, data.info.id);
  }

  private readonly seenForwardedQuestionCalls = new Set<string>();

  private async handleQuestionToolPart(part: {
    id: string;
    callID: string;
    state?: {
      status?: string;
      input?: { questions?: unknown };
      output?: string;
    };
  }): Promise<void> {
    const status = part.state?.status;
    if (status === "completed" || status === "error") {
      this.seenForwardedQuestionCalls.delete(part.callID);
      return;
    }
    if (status !== "pending" && status !== "running") return;

    // Try to read questions directly from the tool call state.
    const inputQuestions = part.state?.input?.questions;
    const hasDirectQuestions = Array.isArray(inputQuestions) && inputQuestions.length > 0;
    if (hasDirectQuestions) {
      const questions = normalizeQuestions(inputQuestions);
      if (questions.length > 0 && !this.seenForwardedQuestionCalls.has(part.callID)) {
        this.seenForwardedQuestionCalls.add(part.callID);
        this.debugLog?.(
          `forward: question tool-call id=${part.id} callID=${part.callID} questions=${questions.length} (from state)`,
        );
        if (this.handlers.onQuestionAsked) {
          await this.handlers.onQuestionAsked({
            id: part.callID,
            sessionID: this.sessionID,
            questions,
            tool: { messageID: part.id, callID: part.callID },
          });
          return;
        }
      }
    }

    // Fallback: poll client.question.list() like OpenCode TUI does.
    // The TUI triggers polling when a question tool call arrives in "running"
    // state but no question.asked event was received.
    if (status === "running" && !this.seenForwardedQuestionCalls.has(part.callID)) {
      await this.pollQuestionList(part.callID, part.id);
    }
  }

  private async pollQuestionList(callID: string, partID: string): Promise<void> {
    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.abort.signal.aborted) return;
      try {
        const result = await this.client.question.list();
        const items = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
        const match = items.find(
          (q: any) => q.sessionID === this.sessionID && q?.tool?.callID === callID,
        );
        if (match) {
          const questions = normalizeQuestions(match.questions);
          if (questions.length > 0 && !this.seenForwardedQuestionCalls.has(callID)) {
            this.seenForwardedQuestionCalls.add(callID);
            this.debugLog?.(
              `forward: question poll id=${match.id} callID=${callID} questions=${questions.length}`,
            );
            if (this.handlers.onQuestionAsked) {
              await this.handlers.onQuestionAsked({
                id: match.id,
                sessionID: this.sessionID,
                questions,
                tool: match.tool ?? { messageID: partID, callID },
              });
            }
            return;
          }
        }
      } catch (err) {
        this.debugLog?.(`question list poll error: ${String(err)}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    this.debugLog?.(`question poll timeout for callID=${callID}`);
    this.seenForwardedQuestionCalls.delete(callID);
  }
}
