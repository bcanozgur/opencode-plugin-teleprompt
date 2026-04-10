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
  onSessionError: (event: { sessionID?: string; error?: { name?: string } }) => Promise<void>;
  onUserMessage: (sessionID: string, userMessageID: string) => Promise<void>;
  onStreamError?: (error: unknown) => Promise<void>;
};

export class SessionEventStream {
  private abort = new AbortController();
  private running?: Promise<void>;

  constructor(
    private readonly client: any,
    private readonly sessionID: string,
    private readonly handlers: EventHandlers,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = this.loop().catch(async (error) => {
      if (this.abort.signal.aborted) return;
      await this.handlers.onStreamError?.(error);
    });
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.running;
    this.running = undefined;
  }

  private async loop(): Promise<void> {
    const streamResult = await this.client.event.subscribe();
    try {
      for await (const event of streamResult.stream as AsyncIterable<any>) {
        if (this.abort.signal.aborted) break;
        if (!event || typeof event !== "object") continue;
        await this.handleEvent(event);
      }
    } catch {
      if (!this.abort.signal.aborted) {
        throw new Error("Event stream terminated unexpectedly.");
      }
    }
  }

  private async handleEvent(event: any): Promise<void> {
    if (event.type === "permission.asked") {
      const data = event.properties as {
        id: string;
        sessionID: string;
        permission: string;
        patterns: string[];
        metadata: Record<string, unknown>;
      };
      if (data.sessionID !== this.sessionID) return;
      await this.handlers.onPermissionAsked(data);
      return;
    }

    if (event.type === "session.error") {
      const data = event.properties as { sessionID?: string; error?: { name?: string } };
      if (data.sessionID && data.sessionID !== this.sessionID) return;
      await this.handlers.onSessionError(data);
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
}
