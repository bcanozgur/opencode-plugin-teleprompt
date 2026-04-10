import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  BridgeConfig,
  BridgeStoreData,
  ParsedTelegramCommand,
  PromptHistoryItem,
  PromptJob,
  RuntimeDeps,
  SummaryPayload,
} from "../types.js";
import { getCurrentSessionID } from "../opencode/binding.js";
import { replyPermission, toPendingPermission, formatPermissionRequestMessage } from "../opencode/permissions.js";
import { createTelegramUserMessageID, submitPrompt } from "../opencode/submit.js";
import { formatSummaryForTelegram } from "../summary/format.js";
import { LeaseManager } from "../state/lease.js";
import { BridgeStore } from "../state/store.js";
import { TelegramApi } from "../telegram/api.js";
import { TelegramPoller } from "../telegram/poller.js";
import { SessionEventStream } from "../opencode/events.js";
import { createShutdownGuard } from "./shutdown.js";
import type { TuiPluginApi } from "../tui-types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_DEPS: RuntimeDeps = {
  now: () => Date.now(),
  randomID: () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
};

type AvailableModel = {
  providerID: string;
  modelID: string;
  name?: string;
};

function formatAgeMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m${remSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h${remMinutes}m`;
}

function formatGroupedModels(
  models: AvailableModel[],
  current?: { providerID: string; modelID: string },
): string {
  const grouped = new Map<string, AvailableModel[]>();
  for (const model of models) {
    const list = grouped.get(model.providerID) ?? [];
    list.push(model);
    grouped.set(model.providerID, list);
  }

  const providerIDs = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];
  for (const providerID of providerIDs) {
    lines.push(`${providerID}:`);
    const providerModels = grouped.get(providerID) ?? [];
    providerModels.sort((a, b) => a.modelID.localeCompare(b.modelID));
    for (const model of providerModels) {
      const label = `${providerID}/${model.modelID}`;
      const isCurrent =
        current &&
        current.providerID === model.providerID &&
        current.modelID === model.modelID;
      const suffix = model.name && model.name !== model.modelID ? ` (${model.name})` : "";
      lines.push(`- ${label}${suffix}${isCurrent ? " [current]" : ""}`);
    }
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

function preview(text: string, max = 90): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function resolvePresetModel(
  preset: "fast" | "smart" | "max",
  models: AvailableModel[],
): AvailableModel | undefined {
  const scored = models
    .map((model) => {
      const key = `${model.providerID}/${model.modelID} ${model.name ?? ""}`.toLowerCase();
      let score = 0;
      if (preset === "fast") {
        if (key.includes("mini")) score += 60;
        if (key.includes("haiku")) score += 50;
        if (key.includes("flash")) score += 50;
        if (key.includes("nano")) score += 40;
        if (key.includes("fast")) score += 40;
      } else if (preset === "smart") {
        if (key.includes("sonnet")) score += 60;
        if (key.includes("gpt-5")) score += 55;
        if (key.includes("claude-3.7")) score += 50;
        if (key.includes("medium")) score += 35;
      } else {
        if (key.includes("opus")) score += 70;
        if (key.includes("max")) score += 60;
        if (key.includes("gpt-5.4")) score += 55;
        if (key.includes("pro")) score += 40;
        if (key.includes("reason")) score += 35;
      }
      // Prefer stable families over unknown names when preset tie happens.
      if (key.includes("gpt") || key.includes("claude") || key.includes("gemini")) {
        score += 3;
      }
      return { model, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return undefined;
  if (scored[0].score <= 0) return undefined;
  return scored[0].model;
}

export class BridgeController {
  private readonly deps: RuntimeDeps;
  private readonly instanceID: string;
  private readonly client: any;
  private readonly telegram: TelegramApi;
  private readonly store: BridgeStore;
  private readonly lease: LeaseManager;
  private data?: BridgeStoreData;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private pollAbort?: AbortController;
  private pollTask?: Promise<void>;
  private eventStream?: SessionEventStream;
  private eventRestartTimer?: ReturnType<typeof setTimeout>;
  private readonly shutdownOnce = createShutdownGuard();
  private processingQueue = false;
  private lastEscAt = 0;

  constructor(
    private readonly api: TuiPluginApi,
    private readonly config: BridgeConfig,
    storePath: string,
    deps?: Partial<RuntimeDeps>,
  ) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
    this.instanceID = this.deps.randomID();
    this.client = api.client;
    this.telegram = new TelegramApi(config.botToken);
    this.store = new BridgeStore(storePath, config.channelID);
    this.lease = new LeaseManager(
      this.instanceID,
      this.deps.now,
      config.leaseTtlMs,
    );
  }

  async init(): Promise<void> {
    this.data = await this.store.load();
  }

  async bindCurrent(): Promise<string> {
    const sessionID = getCurrentSessionID(this.api);
    const state = await this.syncState();
    const claimed = this.lease.claim(state);
    claimed.bound.sessionID = sessionID;
    claimed.bound.status = "online";
    claimed.bound.model = undefined;
    await this.persist(claimed);
    this.startHeartbeat();
    await this.startEventStream(sessionID);
    this.startPolling();
    if (this.config.onlineNotice) {
      await this.telegram.sendMessage(
        this.config.channelID,
        `OpenCode Telegram bridge online.\nsession_id: ${sessionID}`,
      );
    }
    return sessionID;
  }

  async unbind(): Promise<void> {
    const state = await this.syncState();
    if (state.lease && !this.lease.isOwner(state)) {
      throw new Error(
        `Cannot unbind: bridge is owned by ${state.lease.ownerInstanceID}.`,
      );
    }
    await this.stopRuntime(true);
    const latest = await this.syncState();
    const released = this.lease.release({
      ...latest,
      bound: {
        ...latest.bound,
        status: "offline",
        sessionID: undefined,
      },
      activePrompt: undefined,
      promptQueue: [],
      pendingPermissions: {},
    });
    await this.persist(released);
  }

  async statusLine(): Promise<string> {
    const state = await this.syncState();
    const owner = state.lease?.ownerInstanceID ?? "none";
    const session = state.bound.sessionID ?? "none";
    const model = state.bound.model
      ? `${state.bound.model.providerID}/${state.bound.model.modelID}`
      : "default";
    const now = this.deps.now();
    const heartbeatFreshness = state.lease
      ? formatAgeMs(Math.max(0, now - state.lease.ownerHeartbeatAt))
      : "n/a";
    const activeElapsed = state.activePrompt
      ? formatAgeMs(Math.max(0, now - (state.activePrompt.startedAt ?? state.activePrompt.createdAt)))
      : "none";
    const cwd = process.cwd();
    const branch = await this.getGitBranch();
    const lines = [
      `status=${state.bound.status}`,
      `session=${session}`,
      `owner=${owner}`,
      `cwd=${cwd}`,
      `branch=${branch ?? "n/a"}`,
      `model=${model}`,
      `active_elapsed=${activeElapsed}`,
      `queue=${state.promptQueue.length}`,
      `pending_permissions=${Object.keys(state.pendingPermissions).length}`,
      `heartbeat_age=${heartbeatFreshness}`,
    ];
    return lines.join("\n");
  }

  async handleTelegramCommand(command: ParsedTelegramCommand): Promise<void> {
    const state = await this.syncState();
    const isOwner = this.lease.isOwner(state);
    const alwaysAllowed = new Set(["status", "who", "health", "reclaim"]);
    if (!isOwner && !alwaysAllowed.has(command.command.kind)) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "Bridge is currently owned by another OpenCode instance. Use /tp:reclaim first.",
        { replyToMessageID: command.messageID },
      );
      return;
    }

    if (command.command.kind === "status") {
      await this.telegram.sendMessage(
        this.config.channelID,
        await this.statusLine(),
        { replyToMessageID: command.messageID },
      );
      return;
    }

    if (command.command.kind === "disconnect") {
      const state = await this.requireState();
      if (state.bound.status !== "online") {
        await this.telegram.sendMessage(
          this.config.channelID,
          "Bridge already offline.",
          { replyToMessageID: command.messageID },
        );
        return;
      }
      await this.unbind();
      await this.telegram.sendMessage(
        this.config.channelID,
        "Teleprompt disconnected from Telegram (/tp:dc).",
        { replyToMessageID: command.messageID },
      );
      return;
    }

    if (command.command.kind === "interrupt") {
      await this.handleInterrupt(command.messageID);
      return;
    }

    if (command.command.kind === "queue") {
      await this.handleQueue(command.messageID);
      return;
    }

    if (command.command.kind === "cancel") {
      await this.handleCancel(command.command.target, command.messageID);
      return;
    }

    if (command.command.kind === "retry") {
      await this.handleRetry(command.updateID, command.messageID, command.channelID);
      return;
    }

    if (command.command.kind === "context") {
      await this.handleContext(command.messageID);
      return;
    }

    if (command.command.kind === "compact") {
      await this.handleCompact(command.messageID);
      return;
    }

    if (command.command.kind === "newsession") {
      await this.handleNewSession(command.messageID);
      return;
    }

    if (command.command.kind === "reset-context") {
      await this.handleResetContext(command.messageID);
      return;
    }

    if (command.command.kind === "who") {
      await this.handleWho(command.messageID);
      return;
    }

    if (command.command.kind === "health") {
      await this.handleHealth(command.messageID);
      return;
    }

    if (command.command.kind === "reclaim") {
      await this.handleReclaim(command.messageID);
      return;
    }

    if (command.command.kind === "history") {
      await this.handleHistory(command.messageID);
      return;
    }

    if (command.command.kind === "last-error") {
      await this.handleLastError(command.messageID);
      return;
    }

    if (command.command.kind === "model") {
      await this.handleModelCommand(
        command.command.target,
        command.command.preset,
        command.messageID,
      );
      return;
    }

    if (command.command.kind === "permission") {
      await this.handlePermissionReply(
        command.command.requestID,
        command.command.action,
        command.messageID,
      );
      return;
    }

    if (state.bound.status !== "online" || !state.bound.sessionID) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "Bridge is offline. Run /tp:start in OpenCode first.",
        { replyToMessageID: command.messageID },
      );
      return;
    }

    await this.telegram.sendMessage(
      this.config.channelID,
      "accepted",
      { replyToMessageID: command.messageID },
    );
    const job: PromptJob = {
      telegramUpdateID: command.updateID,
      telegramMessageID: command.messageID,
      telegramChannelID: command.channelID,
      prompt: command.command.prompt,
      userMessageID: createTelegramUserMessageID(command.updateID),
      createdAt: this.deps.now(),
    };
    const next = {
      ...state,
      promptQueue: [...state.promptQueue, job],
      recentPrompts: [
        ...state.recentPrompts,
        {
          jobID: job.userMessageID,
          prompt: job.prompt,
          at: job.createdAt,
        },
      ].slice(-20),
    };
    await this.persist(next);
    const queuePosition = next.promptQueue.length + (next.activePrompt ? 1 : 0);
    if (queuePosition > 1) {
      await this.telegram.sendMessage(
        this.config.channelID,
        `queued (${queuePosition})`,
        { replyToMessageID: command.messageID },
      );
    }
    await this.processPromptQueue();
  }

  async shutdown(): Promise<void> {
    await this.shutdownOnce(async () => {
      await this.stopRuntime(false);
      const state = await this.syncState();
      if (!this.lease.isOwner(state)) return;
      const next = this.lease.release({
        ...state,
        bound: {
          ...state.bound,
          status: "offline",
        },
      });
      await this.persist(next);
      if (this.config.offlineNotice && next.bound.sessionID) {
        await this.telegram.sendMessage(
          this.config.channelID,
          `OpenCode Telegram bridge offline.\nsession_id: ${next.bound.sessionID}`,
        );
      }
    });
  }

  async handleLocalTuiCommand(command: string): Promise<void> {
    const state = await this.syncState();
    if (state.bound.status !== "online" || !state.bound.sessionID) return;
    if (command !== "session.interrupt" && command !== "prompt.clear") return;
    if (!this.lease.isOwner(state)) {
      this.api.ui.toast({
        variant: "warning",
        message: "Teleprompt is owned by another OpenCode instance.",
      });
      return;
    }

    const now = this.deps.now();
    if (now - this.lastEscAt <= 1400) {
      await this.unbind();
      this.api.ui.toast({
        variant: "success",
        message: "Teleprompt disconnected (double ESC). Local input unlocked.",
      });
      return;
    }
    this.lastEscAt = now;
    this.api.ui.toast({
      variant: "info",
      message: "Teleprompt active. Press ESC again to disconnect.",
    });
  }

  private async processPromptQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;
    try {
      while (true) {
        const state = await this.syncState();
        if (!this.lease.isOwner(state)) return;
        if (state.activePrompt || state.promptQueue.length === 0) return;
        const job = state.promptQueue[0];
        if (!state.bound.sessionID) return;
        const startedAt = this.deps.now();
        const activeJob: PromptJob = {
          ...job,
          startedAt,
        };
        const next = {
          ...state,
          activePrompt: activeJob,
          promptQueue: state.promptQueue.slice(1),
        };
        await this.persist(next);
        await this.telegram.sendMessage(
          this.config.channelID,
          "running",
          { replyToMessageID: activeJob.telegramMessageID },
        );
        try {
          await submitPrompt(
            this.client,
            state.bound.sessionID,
            job.prompt,
            job.telegramUpdateID,
            state.bound.model,
          );
        } catch (error) {
          const latest = await this.requireState();
          if (latest.activePrompt?.userMessageID === activeJob.userMessageID) {
            await this.persist(
              this.appendPromptHistory(
                {
                  ...latest,
                  activePrompt: undefined,
                },
                {
                  jobID: activeJob.userMessageID,
                  prompt: activeJob.prompt,
                  summary: String(error),
                  changedFiles: [],
                  status: "failed",
                  at: this.deps.now(),
                },
              ),
            );
          }
          await this.telegram.sendMessage(
            this.config.channelID,
            `failed: ${String(error)}`,
            { replyToMessageID: activeJob.telegramMessageID },
          );
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private async onAssistantCompleted(
    sessionID: string,
    assistantMessageID: string,
    parentUserMessageID: string,
  ): Promise<void> {
    const state = await this.syncState();
    if (!this.lease.isOwner(state)) return;
    if (!state.activePrompt) return;
    if (state.activePrompt.userMessageID !== parentUserMessageID) return;
    if (state.bound.sessionID !== sessionID) return;

    const summary = await this.buildSummary(
      sessionID,
      assistantMessageID,
      state.activePrompt.userMessageID,
    );
    const completedAt = this.deps.now();
    const elapsed = completedAt - (state.activePrompt.startedAt ?? state.activePrompt.createdAt);
    const message = formatSummaryForTelegram(summary, this.config.summaryMaxChars);
    await this.telegram.sendMessage(
      this.config.channelID,
      `completed in ${formatAgeMs(Math.max(0, elapsed))}`,
      { replyToMessageID: state.activePrompt.telegramMessageID },
    );
    await this.telegram.sendMessage(
      this.config.channelID,
      message,
      { replyToMessageID: state.activePrompt.telegramMessageID },
    );

    await this.persist(
      this.appendPromptHistory(
        {
          ...state,
          activePrompt: undefined,
        },
        {
          jobID: state.activePrompt.userMessageID,
          prompt: state.activePrompt.prompt,
          summary: summary.text,
          changedFiles: summary.changedFiles,
          status: "completed",
          at: completedAt,
        },
      ),
    );
    await this.processPromptQueue();
  }

  private async onUserMessage(
    sessionID: string,
    userMessageID: string,
  ): Promise<void> {
    const state = await this.syncState();
    if (!this.lease.isOwner(state)) return;
    if (state.bound.status !== "online") return;
    if (state.bound.sessionID !== sessionID) return;
    if (userMessageID.startsWith("tg-")) return;

    try {
      await this.client.session.abort({ sessionID });
    } catch {}
    try {
      await this.client.session.deleteMessage({ sessionID, messageID: userMessageID });
    } catch {}
    this.api.ui.toast({
      variant: "warning",
      message:
        "Teleprompt is active. Local prompt input is locked. Press ESC twice to disconnect.",
    });
  }

  private async onPermissionAsked(input: {
    id: string;
    sessionID: string;
    permission: string;
    patterns: string[];
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const state = await this.syncState();
    if (!this.lease.isOwner(state)) return;
    if (state.bound.sessionID !== input.sessionID) return;
    const pending = toPendingPermission(input);
    const next = {
      ...state,
      pendingPermissions: {
        ...state.pendingPermissions,
        [pending.requestID]: pending,
      },
    };
    await this.persist(next);
    const activeReplyTo = state.activePrompt?.telegramMessageID;
    await this.telegram.sendMessage(
      this.config.channelID,
      "waiting-permission",
      activeReplyTo ? { replyToMessageID: activeReplyTo } : undefined,
    );
    await this.telegram.sendMessage(
      this.config.channelID,
      formatPermissionRequestMessage(this.config.prefix, pending),
      activeReplyTo ? { replyToMessageID: activeReplyTo } : undefined,
    );
  }

  private async handlePermissionReply(
    requestID: string,
    action: "once" | "always" | "reject",
    replyToMessageID?: number,
  ): Promise<void> {
    const state = await this.syncState();
    if (!this.lease.isOwner(state)) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "Cannot apply permission reply: this instance is not the current bridge owner.",
        replyToMessageID ? { replyToMessageID } : undefined,
      );
      return;
    }
    const pending = state.pendingPermissions[requestID];
    if (!pending) {
      await this.telegram.sendMessage(
        this.config.channelID,
        `Permission request not found: ${requestID}`,
        replyToMessageID ? { replyToMessageID } : undefined,
      );
      return;
    }
    await replyPermission(this.client, requestID, action);
    const { [requestID]: _removed, ...rest } = state.pendingPermissions;
    await this.persist({
      ...state,
      pendingPermissions: rest,
    });
    await this.telegram.sendMessage(
      this.config.channelID,
      `Permission ${requestID} -> ${action}`,
      replyToMessageID ? { replyToMessageID } : undefined,
    );
  }

  private async handleModelCommand(
    target: { providerID: string; modelID: string } | undefined,
    preset: "fast" | "smart" | "max" | undefined,
    replyToMessageID?: number,
  ): Promise<void> {
    const state = await this.requireState();
    if (state.bound.status !== "online" || !state.bound.sessionID) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "Bridge is offline. Run /tp:start in OpenCode first.",
        replyToMessageID ? { replyToMessageID } : undefined,
      );
      return;
    }

    const available = await this.fetchAvailableModels();
    if (available.length === 0) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "No available models found from OpenCode providers.",
        replyToMessageID ? { replyToMessageID } : undefined,
      );
      return;
    }

    if (!target && !preset) {
      const current = state.bound.model
        ? `${state.bound.model.providerID}/${state.bound.model.modelID}`
        : "default (OpenCode session default)";
      const grouped = formatGroupedModels(available, state.bound.model);
      await this.telegram.sendMessage(
        this.config.channelID,
        `Current model: ${current}\n\nValid models:\n${grouped}\n\nSet with: /tp:model <provider>/<model>\nPresets: /tp:model fast | /tp:model smart | /tp:model max`,
        replyToMessageID ? { replyToMessageID } : undefined,
      );
      return;
    }

    let found: AvailableModel | undefined;
    if (preset) {
      found = resolvePresetModel(preset, available);
      if (!found) {
        await this.telegram.sendMessage(
          this.config.channelID,
          `Could not resolve preset '${preset}'. Use /tp:model to list explicit options.`,
          replyToMessageID ? { replyToMessageID } : undefined,
        );
        return;
      }
    } else {
      found = available.find(
        (item) =>
          item.providerID.toLowerCase() === target!.providerID.toLowerCase() &&
          item.modelID.toLowerCase() === target!.modelID.toLowerCase(),
      );
    }
    if (!found) {
      await this.telegram.sendMessage(
        this.config.channelID,
        `Invalid model: ${target?.providerID}/${target?.modelID}\nUse /tp:model to list valid options.`,
        replyToMessageID ? { replyToMessageID } : undefined,
      );
      return;
    }

    await this.persist({
      ...state,
      bound: {
        ...state.bound,
        model: {
          providerID: found.providerID,
          modelID: found.modelID,
        },
      },
    });
    await this.telegram.sendMessage(
      this.config.channelID,
      preset
        ? `Model preset '${preset}' selected for session ${state.bound.sessionID}: ${found.providerID}/${found.modelID}`
        : `Model updated for session ${state.bound.sessionID}: ${found.providerID}/${found.modelID}`,
      replyToMessageID ? { replyToMessageID } : undefined,
    );
  }

  private async fetchAvailableModels(): Promise<AvailableModel[]> {
    try {
      const response = await this.client.config.providers(
        {},
        { responseStyle: "data", throwOnError: true },
      );
      const providers = (response as any)?.providers as Array<{
        id?: string;
        models?: Record<string, { id?: string; name?: string }>;
      }> | undefined;
      if (!Array.isArray(providers)) return [];
      const output: AvailableModel[] = [];
      for (const provider of providers) {
        const providerID = provider.id;
        if (!providerID || !provider.models) continue;
        for (const [key, value] of Object.entries(provider.models)) {
          const modelID = value?.id || key;
          output.push({
            providerID,
            modelID,
            name: value?.name,
          });
        }
      }
      output.sort((a, b) => {
        const left = `${a.providerID}/${a.modelID}`.toLowerCase();
        const right = `${b.providerID}/${b.modelID}`.toLowerCase();
        return left.localeCompare(right);
      });
      return output;
    } catch {
      return [];
    }
  }

  private async buildSummary(
    sessionID: string,
    assistantMessageID: string,
    userMessageID: string,
  ): Promise<SummaryPayload> {
    const parts = this.api.state.part(assistantMessageID);
    const text = parts
      .filter((part): part is { type: "text"; text: string } => {
        return part.type === "text" && typeof part.text === "string";
      })
      .map((part) => part.text)
      .join("")
      .trim();

    let changedFiles: string[] = [];
    try {
      const diffResponse = await this.client.session.diff(
        {
          sessionID,
          messageID: userMessageID,
        },
        { responseStyle: "data", throwOnError: true },
      );
      const diff = (diffResponse as any).diff as Array<{ file: string }> | undefined;
      changedFiles = (diff || []).map((item) => item.file);
    } catch {
      changedFiles = [];
    }

    return {
      text: text || "(assistant completed with no text output)",
      changedFiles,
    };
  }

  private async handleQueue(replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    const now = this.deps.now();
    const lines: string[] = [];
    lines.push("Queue status:");
    if (state.activePrompt) {
      lines.push(
        `active: ${state.activePrompt.userMessageID} (${formatAgeMs(now - (state.activePrompt.startedAt ?? state.activePrompt.createdAt))})`,
      );
      lines.push(`active_prompt: ${preview(state.activePrompt.prompt)}`);
    } else {
      lines.push("active: none");
    }
    lines.push(`queued: ${state.promptQueue.length}`);
    for (const [idx, job] of state.promptQueue.entries()) {
      lines.push(
        `${idx + 1}. ${job.userMessageID} (${formatAgeMs(now - job.createdAt)}) ${preview(job.prompt, 70)}`,
      );
    }
    await this.telegram.sendMessage(
      this.config.channelID,
      lines.join("\n"),
      { replyToMessageID },
    );
  }

  private async handleCancel(target: string, replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    if (state.promptQueue.length === 0) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "Queue is empty. Nothing to cancel.",
        { replyToMessageID },
      );
      return;
    }

    let index = -1;
    if (target.toLowerCase() === "last") {
      index = state.promptQueue.length - 1;
    } else {
      index = state.promptQueue.findIndex((item) => item.userMessageID === target);
    }
    if (index < 0) {
      if (state.activePrompt && state.activePrompt.userMessageID === target) {
        await this.telegram.sendMessage(
          this.config.channelID,
          `Job ${target} is active. Use /tp:interrupt to stop it.`,
          { replyToMessageID },
        );
        return;
      }
      await this.telegram.sendMessage(
        this.config.channelID,
        `Queued job not found: ${target}`,
        { replyToMessageID },
      );
      return;
    }

    const removed = state.promptQueue[index];
    const nextQueue = state.promptQueue.filter((_, i) => i !== index);
    await this.persist({
      ...state,
      promptQueue: nextQueue,
    });
    await this.telegram.sendMessage(
      this.config.channelID,
      `Canceled queued job ${removed.userMessageID}.`,
      { replyToMessageID },
    );
  }

  private async handleRetry(
    updateID: number,
    messageID: number,
    channelID: string,
  ): Promise<void> {
    const state = await this.requireState();
    if (state.bound.status !== "online" || !state.bound.sessionID) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "Bridge is offline. Run /tp:start in OpenCode first.",
        { replyToMessageID: messageID },
      );
      return;
    }
    const last = [...state.promptHistory].reverse().find((item) => item.prompt.trim().length > 0);
    if (!last) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "No previous prompt found to retry.",
        { replyToMessageID: messageID },
      );
      return;
    }
    const retryJob: PromptJob = {
      telegramUpdateID: updateID,
      telegramMessageID: messageID,
      telegramChannelID: channelID,
      prompt: last.prompt,
      userMessageID: createTelegramUserMessageID(updateID),
      createdAt: this.deps.now(),
    };
    const next = {
      ...state,
      promptQueue: [...state.promptQueue, retryJob],
      recentPrompts: [
        ...state.recentPrompts,
        {
          jobID: retryJob.userMessageID,
          prompt: retryJob.prompt,
          at: retryJob.createdAt,
        },
      ].slice(-20),
    };
    await this.persist(next);
    await this.telegram.sendMessage(
      this.config.channelID,
      `Retry queued from ${last.jobID} -> ${retryJob.userMessageID}`,
      { replyToMessageID: messageID },
    );
    await this.processPromptQueue();
  }

  private async handleContext(replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    const currentModel = state.bound.model
      ? `${state.bound.model.providerID}/${state.bound.model.modelID}`
      : "default";
    const sessionTitle = await this.getSessionTitle(state.bound.sessionID);
    const recentPrompts = [...state.recentPrompts].slice(-3).reverse();
    const recentHistory = [...state.promptHistory].slice(-3).reverse();
    const lines: string[] = [
      `session=${state.bound.sessionID ?? "none"}`,
      `title=${sessionTitle ?? "n/a"}`,
      `model=${currentModel}`,
      "",
      "Recent user requests:",
    ];
    if (recentPrompts.length === 0) {
      lines.push("- (none)");
    } else {
      for (const item of recentPrompts) {
        lines.push(`- ${item.jobID}: ${preview(item.prompt, 80)}`);
      }
    }
    lines.push("");
    lines.push("Last assistant summaries:");
    if (recentHistory.length === 0) {
      lines.push("- (none)");
    } else {
      for (const item of recentHistory) {
        lines.push(`- ${item.jobID} [${item.status}]: ${preview(item.summary, 90)}`);
      }
      const changed = recentHistory[0]?.changedFiles ?? [];
      lines.push("");
      lines.push("Recent changed files:");
      if (changed.length === 0) lines.push("- (none)");
      for (const file of changed.slice(0, 8)) {
        lines.push(`- ${file}`);
      }
    }
    await this.telegram.sendMessage(
      this.config.channelID,
      lines.join("\n"),
      { replyToMessageID },
    );
  }

  private async handleCompact(replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    if (!state.bound.sessionID || state.bound.status !== "online") {
      await this.telegram.sendMessage(
        this.config.channelID,
        "Bridge is offline. Run /tp:start in OpenCode first.",
        { replyToMessageID },
      );
      return;
    }
    try {
      await this.client.session.summarize(
        { sessionID: state.bound.sessionID },
        { responseStyle: "data", throwOnError: true },
      );
      await this.telegram.sendMessage(
        this.config.channelID,
        `Compaction requested for session ${state.bound.sessionID}.`,
        { replyToMessageID },
      );
    } catch (error) {
      await this.telegram.sendMessage(
        this.config.channelID,
        `Compaction failed: ${String(error)}`,
        { replyToMessageID },
      );
    }
  }

  private async handleNewSession(replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    if (state.bound.status !== "online") {
      await this.telegram.sendMessage(
        this.config.channelID,
        "Bridge is offline. Run /tp:start in OpenCode first.",
        { replyToMessageID },
      );
      return;
    }
    try {
      const response = await this.client.session.create(
        {},
        { responseStyle: "data", throwOnError: true },
      );
      const nextSessionID = (response as any)?.session?.id ?? (response as any)?.id;
      if (!nextSessionID || typeof nextSessionID !== "string") {
        throw new Error("Could not resolve new session id.");
      }
      await this.switchBoundSession(nextSessionID);
      await this.telegram.sendMessage(
        this.config.channelID,
        `Created and switched to new session: ${nextSessionID}`,
        { replyToMessageID },
      );
    } catch (error) {
      await this.telegram.sendMessage(
        this.config.channelID,
        `New session failed: ${String(error)}`,
        { replyToMessageID },
      );
    }
  }

  private async handleResetContext(replyToMessageID: number): Promise<void> {
    await this.handleNewSession(replyToMessageID);
  }

  private async handleWho(replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    const lease = state.lease;
    const lines = [
      `instance_id=${this.instanceID}`,
      `lease_owner=${lease?.ownerInstanceID ?? "none"}`,
      `is_owner=${this.lease.isOwner(state) ? "true" : "false"}`,
      `session=${state.bound.sessionID ?? "none"}`,
      `status=${state.bound.status}`,
    ];
    await this.telegram.sendMessage(
      this.config.channelID,
      lines.join("\n"),
      { replyToMessageID },
    );
  }

  private async handleHealth(replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    const now = this.deps.now();
    const leaseAge = state.lease
      ? formatAgeMs(Math.max(0, now - state.lease.ownerHeartbeatAt))
      : "n/a";
    const stale =
      state.lease && now - state.lease.ownerHeartbeatAt > this.config.leaseTtlMs
        ? "true"
        : "false";
    const lines = [
      `status=${state.bound.status}`,
      `session=${state.bound.sessionID ?? "none"}`,
      `lease_owner=${state.lease?.ownerInstanceID ?? "none"}`,
      `lease_age=${leaseAge}`,
      `lease_stale=${stale}`,
      `is_owner=${this.lease.isOwner(state) ? "true" : "false"}`,
      `polling=${this.pollTask ? "running" : "stopped"}`,
      `event_stream=${this.eventStream ? "running" : "stopped"}`,
      `queue=${state.promptQueue.length}`,
      `pending_permissions=${Object.keys(state.pendingPermissions).length}`,
    ];
    await this.telegram.sendMessage(
      this.config.channelID,
      lines.join("\n"),
      { replyToMessageID },
    );
  }

  private async handleReclaim(replyToMessageID: number): Promise<void> {
    const state = await this.syncState();
    try {
      const claimed = this.lease.claim(state);
      await this.persist(claimed);
      this.startHeartbeat();
      this.startPolling();
      if (claimed.bound.sessionID) {
        await this.startEventStream(claimed.bound.sessionID);
      }
      await this.telegram.sendMessage(
        this.config.channelID,
        `Reclaimed bridge ownership as ${this.instanceID}.`,
        { replyToMessageID },
      );
    } catch (error) {
      await this.telegram.sendMessage(
        this.config.channelID,
        `Reclaim failed: ${String(error)}`,
        { replyToMessageID },
      );
    }
  }

  private async handleHistory(replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    const items = [...state.promptHistory].slice(-10).reverse();
    if (items.length === 0) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "No history yet.",
        { replyToMessageID },
      );
      return;
    }
    const lines = ["Recent history:"];
    for (const item of items) {
      lines.push(
        `- ${item.jobID} [${item.status}] ${new Date(item.at).toISOString()} ${preview(item.summary, 90)}`,
      );
    }
    await this.telegram.sendMessage(
      this.config.channelID,
      lines.join("\n"),
      { replyToMessageID },
    );
  }

  private async handleLastError(replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    const item = [...state.promptHistory]
      .reverse()
      .find((entry) => entry.status === "failed" || entry.status === "interrupted");
    if (!item) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "No failed/interrupted runs found.",
        { replyToMessageID },
      );
      return;
    }
    const lines = [
      `job=${item.jobID}`,
      `status=${item.status}`,
      `at=${new Date(item.at).toISOString()}`,
      `summary=${preview(item.summary, 300)}`,
    ];
    await this.telegram.sendMessage(
      this.config.channelID,
      lines.join("\n"),
      { replyToMessageID },
    );
  }

  private async handleInterrupt(replyToMessageID: number): Promise<void> {
    const state = await this.requireState();
    if (state.bound.status !== "online" || !state.bound.sessionID) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "Bridge is offline. Run /tp:start in OpenCode first.",
        { replyToMessageID },
      );
      return;
    }
    if (!state.activePrompt) {
      await this.telegram.sendMessage(
        this.config.channelID,
        "No active run to interrupt.",
        { replyToMessageID },
      );
      return;
    }

    try {
      await this.client.session.abort({ sessionID: state.bound.sessionID });
      const latest = await this.requireState();
      if (latest.activePrompt?.userMessageID === state.activePrompt.userMessageID) {
        await this.persist(
          this.appendPromptHistory(
            {
              ...latest,
              activePrompt: undefined,
            },
            {
              jobID: state.activePrompt.userMessageID,
              prompt: state.activePrompt.prompt,
              summary: "Interrupted from Telegram.",
              changedFiles: [],
              status: "interrupted",
              at: this.deps.now(),
            },
          ),
        );
      }
      await this.telegram.sendMessage(
        this.config.channelID,
        "Interrupted active run.",
        { replyToMessageID },
      );
      await this.processPromptQueue();
    } catch (error) {
      await this.telegram.sendMessage(
        this.config.channelID,
        `Interrupt failed: ${String(error)}`,
        { replyToMessageID },
      );
    }
  }

  private async onSessionError(event: {
    sessionID?: string;
    error?: { name?: string };
  }): Promise<void> {
    const state = await this.syncState();
    if (!this.lease.isOwner(state)) return;
    if (event.sessionID && state.bound.sessionID !== event.sessionID) return;
    const errorName = event.error?.name ?? "UnknownError";
    if (!state.activePrompt) {
      await this.telegram.sendMessage(
        this.config.channelID,
        `failed: ${errorName}`,
      );
      return;
    }

    const next = {
      ...state,
      activePrompt: undefined,
    };
    await this.persist(
      this.appendPromptHistory(next, {
        jobID: state.activePrompt.userMessageID,
        prompt: state.activePrompt.prompt,
        summary: errorName,
        changedFiles: [],
        status: "failed",
        at: this.deps.now(),
      }),
    );
    await this.telegram.sendMessage(
      this.config.channelID,
      `failed: ${errorName}`,
      { replyToMessageID: state.activePrompt.telegramMessageID },
    );
    await this.processPromptQueue();
  }

  private async getGitBranch(): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync("git", [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      const branch = stdout.trim();
      if (!branch) return undefined;
      return branch;
    } catch {
      return undefined;
    }
  }

  private appendPromptHistory(
    state: BridgeStoreData,
    item: PromptHistoryItem,
  ): BridgeStoreData {
    return {
      ...state,
      promptHistory: [...state.promptHistory, item].slice(-30),
    };
  }

  private async getSessionTitle(sessionID: string | undefined): Promise<string | undefined> {
    if (!sessionID) return undefined;
    try {
      const response = await this.client.session.get(
        { sessionID },
        { responseStyle: "data", throwOnError: true },
      );
      const title = (response as any)?.session?.title;
      if (typeof title === "string" && title.trim().length > 0) return title.trim();
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async switchBoundSession(sessionID: string): Promise<void> {
    const state = await this.syncState();

    const next = {
      ...state,
      bound: {
        ...state.bound,
        sessionID,
        status: "online" as const,
      },
      activePrompt: undefined,
      promptQueue: [],
      pendingPermissions: {},
    };
    await this.persist(next);
    await this.startEventStream(sessionID);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        const state = await this.syncState();
        if (!this.lease.isOwner(state)) return;
        await this.persist(this.lease.refresh(state));
      } catch (error) {
        this.api.ui.toast({
          variant: "error",
          message: `Telegram bridge heartbeat failed: ${String(error)}`,
        });
      }
    }, this.config.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private startPolling(): void {
    if (this.pollTask) return;
    this.pollAbort = new AbortController();
    const poller = new TelegramPoller(
      this.telegram,
      this.config.channelID,
      this.config.prefix,
      this.config.pollTimeoutSec,
      {
        onCommand: (command) => this.handleTelegramCommand(command),
        onOffset: async (offset) => {
          const state = await this.syncState();
          if (!this.lease.isOwner(state)) return;
          await this.persist({ ...state, pollingOffset: offset });
        },
        onError: (error) => {
          this.api.ui.toast({
            variant: "warning",
            message: `Telegram polling error: ${String(error)}`,
          });
        },
      },
    );
    this.pollTask = poller.run(
      this.data?.pollingOffset ?? 0,
      this.pollAbort.signal,
    );
  }

  private async startEventStream(sessionID: string): Promise<void> {
    if (this.eventRestartTimer) {
      clearTimeout(this.eventRestartTimer);
      this.eventRestartTimer = undefined;
    }
    await this.eventStream?.stop();
    this.eventStream = new SessionEventStream(this.client, sessionID, {
      onAssistantCompleted: (sid, assistantID, parentID) =>
        this.onAssistantCompleted(sid, assistantID, parentID),
      onPermissionAsked: (event) => this.onPermissionAsked(event),
      onSessionError: (event) => this.onSessionError(event),
      onUserMessage: (sid, msgID) => this.onUserMessage(sid, msgID),
      onStreamError: (error) => this.onEventStreamError(sessionID, error),
    });
    this.eventStream.start();
  }

  private async onEventStreamError(sessionID: string, error: unknown): Promise<void> {
    this.eventStream = undefined;
    this.api.ui.toast({
      variant: "warning",
      message: `Event stream error: ${String(error)}. Restarting...`,
    });
    if (this.eventRestartTimer) return;
    this.eventRestartTimer = setTimeout(async () => {
      this.eventRestartTimer = undefined;
      try {
        const state = await this.syncState();
        if (!this.lease.isOwner(state)) return;
        if (state.bound.status !== "online" || state.bound.sessionID !== sessionID) return;
        await this.startEventStream(sessionID);
      } catch (restartError) {
        this.api.ui.toast({
          variant: "warning",
          message: `Event stream restart failed: ${String(restartError)}`,
        });
      }
    }, 1500);
  }

  private async stopRuntime(clearJobs: boolean): Promise<void> {
    this.stopHeartbeat();
    if (this.eventRestartTimer) {
      clearTimeout(this.eventRestartTimer);
      this.eventRestartTimer = undefined;
    }
    this.pollAbort?.abort();
    this.pollAbort = undefined;
    await this.pollTask;
    this.pollTask = undefined;
    await this.eventStream?.stop();
    this.eventStream = undefined;

    if (!clearJobs) return;
    const state = await this.requireState();
    await this.persist({
      ...state,
      activePrompt: undefined,
      promptQueue: [],
      pendingPermissions: {},
    });
  }

  private async requireState(): Promise<BridgeStoreData> {
    if (this.data) return this.data;
    this.data = await this.store.load();
    return this.data;
  }

  private async persist(next: BridgeStoreData): Promise<void> {
    this.data = next;
    await this.store.save(next);
  }

  private async syncState(): Promise<BridgeStoreData> {
    const latest = await this.store.load();
    this.data = latest;
    return latest;
  }
}
