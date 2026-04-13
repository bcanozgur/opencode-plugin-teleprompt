export type BridgeConfig = {
  botToken: string;
  channelID: string;
  prefix: string;
  pollTimeoutSec: number;
  heartbeatMs: number;
  leaseTtlMs: number;
  summaryMaxChars: number;
  onlineNotice: boolean;
  offlineNotice: boolean;
};

export type BridgeStatus = "offline" | "online";

export type LeaseRecord = {
  ownerInstanceID: string;
  ownerHeartbeatAt: number;
};

export type BoundState = {
  sessionID?: string;
  channelID: string;
  status: BridgeStatus;
  model?: {
    providerID: string;
    modelID: string;
  };
};

export type PromptJob = {
  telegramUpdateID: number;
  telegramMessageID: number;
  telegramChannelID: string;
  prompt: string;
  userMessageID: string;
  createdAt: number;
  startedAt?: number;
};

export type PendingPermission = {
  requestID: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  announcedAt: number;
};

export type PromptHistoryItem = {
  jobID: string;
  prompt: string;
  summary: string;
  changedFiles: string[];
  status: "completed" | "failed" | "interrupted";
  at: number;
};

export type BridgeStoreData = {
  version: 1;
  pollingOffset: number;
  lease?: LeaseRecord;
  bound: BoundState;
  promptQueue: PromptJob[];
  activePrompt?: PromptJob;
  pendingPermissions: Record<string, PendingPermission>;
  promptHistory: PromptHistoryItem[];
  recentPrompts: Array<{
    jobID: string;
    prompt: string;
    at: number;
  }>;
  updatedAt: number;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramChannelPost;
  channel_post?: TelegramChannelPost;
};

export type TelegramChannelPost = {
  message_id: number;
  date: number;
  chat: {
    id: number | string;
    type: string;
    title?: string;
  };
  text?: string;
};

export type TelegramCommandPrompt = {
  kind: "prompt";
  prompt: string;
};

export type TelegramCommandPermission = {
  kind: "permission";
  action: "once" | "always" | "reject";
  requestID: string;
};

export type TelegramCommandStatus = {
  kind: "status";
};

export type TelegramCommandDisconnect = {
  kind: "disconnect";
};

export type TelegramCommandInterrupt = {
  kind: "interrupt";
};

export type TelegramCommandQueue = {
  kind: "queue";
};

export type TelegramCommandCancel = {
  kind: "cancel";
  target: string;
};

export type TelegramCommandRetry = {
  kind: "retry";
};

export type TelegramCommandContext = {
  kind: "context";
};

export type TelegramCommandCompact = {
  kind: "compact";
};

export type TelegramCommandNewSession = {
  kind: "newsession";
};

export type TelegramCommandResetContext = {
  kind: "reset-context";
};

export type TelegramCommandWho = {
  kind: "who";
};

export type TelegramCommandHealth = {
  kind: "health";
};

export type TelegramCommandReclaim = {
  kind: "reclaim";
};

export type TelegramCommandHistory = {
  kind: "history";
};

export type TelegramCommandLastError = {
  kind: "last-error";
};

export type TelegramCommandVersion = {
  kind: "version";
};

export type TelegramCommandModel = {
  kind: "model";
  target?: {
    providerID: string;
    modelID: string;
  };
  preset?: "fast" | "smart" | "max";
};

export type TelegramCommand =
  | TelegramCommandPrompt
  | TelegramCommandPermission
  | TelegramCommandStatus
  | TelegramCommandDisconnect
  | TelegramCommandInterrupt
  | TelegramCommandQueue
  | TelegramCommandCancel
  | TelegramCommandRetry
  | TelegramCommandContext
  | TelegramCommandCompact
  | TelegramCommandNewSession
  | TelegramCommandResetContext
  | TelegramCommandWho
  | TelegramCommandHealth
  | TelegramCommandReclaim
  | TelegramCommandHistory
  | TelegramCommandLastError
  | TelegramCommandVersion
  | TelegramCommandModel;

export type ParsedTelegramCommand = {
  updateID: number;
  messageID: number;
  channelID: string;
  rawText: string;
  command: TelegramCommand;
};

export type SummaryPayload = {
  text: string;
  changedFiles: string[];
  hadError?: boolean;
};

export type RuntimeDeps = {
  now: () => number;
  randomID: () => string;
};

export type PermissionAskInput = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
};
